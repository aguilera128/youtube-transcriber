import os
import shutil
import uuid
import ssl
import sqlite3
from datetime import datetime
import torch
import warnings

# Workaround for SSL certificate verify failed errors
ssl._create_default_https_context = ssl._create_unverified_context

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
import json
import time
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import yt_dlp
import whisper
from faster_whisper import WhisperModel
from pydantic import BaseModel

app = FastAPI()

# Model caches for lazy loading
whisper_models = {}
faster_whisper_models = {}

# Database setup
DB_NAME = "transcriptions.db"

def init_db():
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS transcriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_url TEXT NOT NULL,
            video_title TEXT,
            transcription TEXT,
            duration REAL,
            word_count INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Migrate existing database: add new columns if they don't exist
    try:
        cursor.execute("ALTER TABLE transcriptions ADD COLUMN duration REAL")
        print("Added 'duration' column to existing table")
    except sqlite3.OperationalError:
        pass  # Column already exists
    
    try:
        cursor.execute("ALTER TABLE transcriptions ADD COLUMN word_count INTEGER")
        print("Added 'word_count' column to existing table")
    except sqlite3.OperationalError:
        pass  # Column already exists
    
    conn.commit()
    conn.close()

# Initialize DB on startup
init_db()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# CORS (optional for local dev but good practice)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class VideoRequest(BaseModel):
    url: str
    engine: str = "whisper"  # "whisper" or "faster-whisper"
    model_size: str = "tiny"  # "tiny", "base", "small", "medium"

def get_device():
    if torch.cuda.is_available():
        return "cuda"
    elif torch.backends.mps.is_available():
        return "mps"
    else:
        return "cpu"

# Device configuration
device = get_device()
use_fp16 = device in ["cuda", "mps"]  # Enable FP16 for GPU acceleration
print(f"Device detected: {device}, FP16 support: {use_fp16}")

def get_whisper_model(model_size="tiny"):
    """Lazy load Whisper model"""
    if model_size not in whisper_models:
        print(f"Loading Whisper model: {model_size}")
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="FP16 is not supported on CPU")
            whisper_models[model_size] = whisper.load_model(model_size, device=device)
    return whisper_models[model_size]

def get_faster_whisper_model(model_size="tiny"):
    """Lazy load Faster-Whisper model"""
    if model_size not in faster_whisper_models:
        print(f"Loading Faster-Whisper model: {model_size}")
        # Faster-Whisper supports float16 only on CUDA, use int8 for CPU/MPS
        if device == "cuda":
            compute_type = "float16"
        else:
            compute_type = "int8"
        faster_whisper_models[model_size] = WhisperModel(
            model_size,
            device="cuda" if device == "cuda" else "cpu",
            compute_type=compute_type
        )
    return faster_whisper_models[model_size]

@app.get("/")
async def read_root():
    return JSONResponse(content={"message": "Welcome to YouTube Transcriber API. Visit /static/index.html for the UI."})

@app.post("/transcribe")
async def transcribe_video(request: VideoRequest):
    video_url = request.url
    engine = request.engine
    model_size = request.model_size
    
    if not video_url:
        raise HTTPException(status_code=400, detail="No URL provided.")

    # Ensure the downloads directory exists
    os.makedirs("downloads", exist_ok=True)

    async def event_generator():
        try:
            start_time = time.time()
            
            # Step 1: Download
            yield json.dumps({"step": "download", "status": "active"}) + "\n"
            
            ydl_opts = {
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
                'outtmpl': 'downloads/%(id)s.%(ext)s',
                'quiet': True,
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_url, download=True)
                video_id = info['id']
                video_title = info['title']
                audio_file = f"downloads/{video_id}.mp3"

            yield json.dumps({"step": "download", "status": "completed"}) + "\n"

            # Step 2: Transcribe
            yield json.dumps({"step": "transcribe", "status": "active", "engine": engine, "model": model_size}) + "\n"
            
            if not os.path.exists(audio_file):
                 yield json.dumps({"error": "Audio download failed."}) + "\n"
                 return

            # Load appropriate model based on engine
            try:
                if engine == "faster-whisper":
                    model = get_faster_whisper_model(model_size)
                    # Faster-Whisper returns segments and info
                    segments, info = model.transcribe(audio_file, beam_size=5)
                    
                    # Convert segments to text with formatting
                    formatted_text = ""
                    current_paragraph = ""
                    
                    for segment in segments:
                        text = segment.text.strip()
                        current_paragraph += text + " "
                        
                        if text.endswith(('.', '!', '?')) and len(current_paragraph) > 300:
                            formatted_text += current_paragraph.strip() + "\n\n"
                            current_paragraph = ""
                    
                    if current_paragraph:
                        formatted_text += current_paragraph.strip()
                    
                    transcription_text = formatted_text
                    
                else:  # Standard Whisper
                    model = get_whisper_model(model_size)
                    result = model.transcribe(audio_file, fp16=use_fp16)
                    
                    # Format text into paragraphs
                    segments = result["segments"]
                    formatted_text = ""
                    current_paragraph = ""
                    
                    for segment in segments:
                        text = segment["text"].strip()
                        current_paragraph += text + " "
                        
                        if text.endswith(('.', '!', '?')) and len(current_paragraph) > 300:
                            formatted_text += current_paragraph.strip() + "\n\n"
                            current_paragraph = ""
                    
                    if current_paragraph:
                        formatted_text += current_paragraph.strip()
                        
                    transcription_text = formatted_text if formatted_text else result["text"]

            except Exception as model_error:
                yield json.dumps({"error": f"Transcription error: {str(model_error)}"}) + "\n"
                return

            # Calculate stats
            end_time = time.time()
            duration = round(end_time - start_time, 2)
            word_count = len(transcription_text.split())

            # Step 3: Save to Database
            try:
                conn = sqlite3.connect(DB_NAME)
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO transcriptions (video_url, video_title, transcription, duration, word_count, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                ''', (video_url, video_title, transcription_text, duration, word_count, datetime.now()))
                conn.commit()
                conn.close()
            except Exception as db_err:
                print(f"Database error: {db_err}")

            # Final Result
            yield json.dumps({
                "step": "complete", 
                "data": {
                    "title": video_title,
                    "transcription": transcription_text,
                    "stats": {
                        "duration": duration,
                        "word_count": word_count
                    }
                }
            }) + "\n"

            # Cleanup
            if os.path.exists(audio_file):
                os.remove(audio_file)

        except Exception as e:
            yield json.dumps({"error": str(e)}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

@app.get("/history")
async def get_history():
    try:
        conn = sqlite3.connect(DB_NAME)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT id, video_title, created_at, video_url FROM transcriptions ORDER BY created_at DESC")
        rows = cursor.fetchall()
        history = [dict(row) for row in rows]
        conn.close()
        return history
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/history/{item_id}")
async def get_history_item(item_id: int):
    try:
        conn = sqlite3.connect(DB_NAME)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM transcriptions WHERE id = ?", (item_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return dict(row)
        else:
            raise HTTPException(status_code=404, detail="Transcription not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

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
from pydantic import BaseModel

app = FastAPI()

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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
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

def get_device():
    if torch.cuda.is_available():
        return "cuda"
    elif torch.backends.mps.is_available():
        return "mps"
    else:
        return "cpu"

# Load Whisper model globally to avoid reloading on every request
# Using "base" model for a balance of speed and accuracy.
# Options: tiny, base, small, medium, large
device = get_device()
print(f"Loading Whisper model on device: {device}")

try:
    # Suppress FP16 warning on CPU if it happens, though we handle device selection
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="FP16 is not supported on CPU")
        model = whisper.load_model("base", device=device)
except Exception as e:
    print(f"Error loading Whisper model: {e}")
    model = None

@app.get("/")
async def read_root():
    return JSONResponse(content={"message": "Welcome to YouTube Transcriber API. Visit /static/index.html for the UI."})

@app.post("/transcribe")
async def transcribe_video(request: VideoRequest):
    if not model:
        raise HTTPException(status_code=500, detail="Whisper model not loaded.")

    video_url = request.url
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
            yield json.dumps({"step": "transcribe", "status": "active"}) + "\n"
            
            if not os.path.exists(audio_file):
                 yield json.dumps({"error": "Audio download failed."}) + "\n"
                 return

            if model is None:
                yield json.dumps({"error": "Whisper model not loaded."}) + "\n"
                return

            # Run transcription in a separate thread to not block the event loop
            # For simplicity in this synchronous generator, we call it directly, 
            # but in a real async app we might want to use run_in_executor if it blocks too much.
            # Since this is a generator, it will block this specific stream, which is fine.
            result = model.transcribe(audio_file)
            
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

            # Calculate stats
            end_time = time.time()
            duration = round(end_time - start_time, 2)
            word_count = len(transcription_text.split())

            # Step 3: Save to Database
            try:
                conn = sqlite3.connect(DB_NAME)
                cursor = conn.cursor()
                cursor.execute('''
                    INSERT INTO transcriptions (video_url, video_title, transcription, created_at)
                    VALUES (?, ?, ?, ?)
                ''', (video_url, video_title, transcription_text, datetime.now()))
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

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

import sqlite3

conn = sqlite3.connect('transcriptions.db')
cursor = conn.cursor()

cursor.execute("SELECT * FROM transcriptions ORDER BY id DESC LIMIT 1")
row = cursor.fetchone()

if row:
    print("Last record found:")
    print(f"ID: {row[0]}")
    print(f"URL: {row[1]}")
    print(f"Title: {row[2]}")
    print(f"Transcription snippet: {row[3][:50]}...")
    print(f"Created At: {row[4]}")
else:
    print("No records found.")

conn.close()

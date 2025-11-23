def format_text(segments):
    formatted_text = ""
    current_paragraph = ""
    
    for segment in segments:
        text = segment["text"].strip()
        current_paragraph += text + " "
        
        # Simple heuristic for paragraph breaks:
        # If text ends with punctuation and paragraph is long enough
        if text.endswith(('.', '!', '?')) and len(current_paragraph) > 300:
            formatted_text += current_paragraph.strip() + "\n\n"
            current_paragraph = ""
    
    # Add any remaining text
    if current_paragraph:
        formatted_text += current_paragraph.strip()
        
    return formatted_text

# Mock data
mock_segments = [
    {"text": "This is the first sentence."},
    {"text": "This is the second sentence and it is quite long to simulate a real transcription scenario where we want to group things together."},
    {"text": "Here is another sentence to add to the length of the paragraph so we can reach the threshold."},
    {"text": "We need more text to reach 300 characters. Let's keep typing until we get there."},
    {"text": "This should be enough to trigger a break soon if we keep adding more sentences like this one."},
    {"text": "Maybe one more long sentence to be sure we cross the line and see if the logic works as expected."},
    {"text": "Finally, a sentence that ends with a period."}, # Should break here if > 300
    {"text": "This should be the start of a new paragraph."}
]

# Adjust threshold for test if needed, or just add enough text
# Let's make the text very long
long_text_segment = " ".join(["Word"] * 50) + "."
mock_segments_long = [{"text": long_text_segment} for _ in range(10)]

formatted = format_text(mock_segments_long)
print(f"Original segments count: {len(mock_segments_long)}")
print(f"Double newlines count: {formatted.count('\n\n')}")
print("--- Output Start ---")
print(formatted[:500])
print("--- Output End ---")

if "\n\n" in formatted:
    print("SUCCESS: Paragraphs created.")
else:
    print("FAILURE: No paragraphs created.")

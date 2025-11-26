document.addEventListener('DOMContentLoaded', () => {
    const videoUrlInput = document.getElementById('videoUrl');
    const transcribeBtn = document.getElementById('transcribeBtn');
    const resultContainer = document.getElementById('resultContainer');
    const videoTitle = document.getElementById('videoTitle');
    const transcriptionText = document.getElementById('transcriptionText');
    const errorMsg = document.getElementById('errorMsg');
    const copyBtn = document.getElementById('copyBtn');

    // Auto-start on paste
    videoUrlInput.addEventListener('paste', (e) => {
        setTimeout(() => {
            const url = videoUrlInput.value.trim();
            // Check if it's a YouTube URL
            if (url && (url.includes('youtube.com') || url.includes('youtu.be'))) {
                transcribeBtn.click();
            }
        }, 100); // Small delay to let the paste complete
    });

    transcribeBtn.addEventListener('click', async () => {
        const url = videoUrlInput.value.trim();
        if (!url) return;

        // Reset UI
        transcribeBtn.classList.add('loading');
        transcribeBtn.disabled = true;
        errorMsg.classList.add('hidden');
        resultContainer.classList.add('hidden');
        transcriptionText.textContent = '';

        // Show Status Pill with Animation
        const statusPill = document.getElementById('statusPill');
        const statusText = statusPill.querySelector('.status-text');
        const progressBarFill = statusPill.querySelector('.progress-bar-fill');

        statusPill.classList.remove('hidden');
        statusPill.style.display = 'flex';
        statusText.textContent = "Iniciando...";
        progressBarFill.style.width = '0%';

        // Reset opacity for stagger
        anime.set('#statusPill', { opacity: 0, translateY: 20 });
        anime.set('.el', { opacity: 0, translateY: 10 });

        // Staggered Entrance Animation
        var timeline = anime.timeline({
            easing: 'easeOutElastic(1, .6)',
            duration: 800
        });

        timeline
            .add({
                targets: '#statusPill',
                translateY: [20, 0],
                opacity: [0, 1],
                duration: 600,
                easing: 'easeOutExpo'
            })
            .add({
                targets: '.el',
                translateY: [10, 0],
                opacity: [0, 1],
                delay: anime.stagger(100), // Stagger each element by 100ms
            }, '-=400');

        try {
            // Get selected model options
            const engine = document.getElementById('engineSelect').value;
            const modelSize = document.getElementById('modelSizeSelect').value;
            const language = document.getElementById('languageSelect').value;

            const response = await fetch('/transcribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url: url,
                    engine: engine,
                    model_size: modelSize,
                    language: language
                }),
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const { value, done } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n').filter(line => line.trim() !== '');

                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);

                        if (data.error) {
                            throw new Error(data.error);
                        }

                        if (data.step === 'download') {
                            if (data.status === 'active') {
                                statusText.textContent = "Descargando audio...";
                                anime({
                                    targets: '.progress-bar-fill',
                                    width: '30%',
                                    duration: 1000,
                                    easing: 'easeInOutQuad'
                                });
                            } else if (data.status === 'completed') {
                                anime({
                                    targets: '.progress-bar-fill',
                                    width: '50%',
                                    duration: 500,
                                    easing: 'easeInOutQuad'
                                });
                            }
                        } else if (data.step === 'transcribe') {
                            if (data.status === 'active') {
                                statusText.textContent = "Transcribiendo con IA...";
                                // Pulse animation for the text to indicate heavy processing
                                anime({
                                    targets: '.status-text',
                                    opacity: [0.7, 1],
                                    duration: 1000,
                                    direction: 'alternate',
                                    loop: true,
                                    easing: 'easeInOutSine'
                                });
                                anime({
                                    targets: '.progress-bar-fill',
                                    width: '90%',
                                    duration: 15000, // Slow progress for transcription
                                    easing: 'easeOutQuad'
                                });
                            }
                        } else if (data.step === 'complete') {
                            // Complete progress bar
                            anime({
                                targets: '.progress-bar-fill',
                                width: '100%',
                                duration: 300,
                                easing: 'easeOutQuad',
                                complete: () => {
                                    // Exit Animation
                                    anime({
                                        targets: '#statusPill',
                                        translateY: [0, -20],
                                        opacity: [1, 0],
                                        scale: [1, 0.9],
                                        duration: 600,
                                        easing: 'easeInBack',
                                        complete: () => {
                                            statusPill.classList.add('hidden');
                                            statusPill.style.display = 'none';
                                        }
                                    });
                                }
                            });

                            // Show Result
                            videoTitle.textContent = data.data.title;

                            // Store segments globally
                            window.currentSegments = data.data.segments || [];
                            window.showingTimestamps = false;

                            // Display transcription (without timestamps by default)
                            transcriptionText.textContent = data.data.transcription;

                            // Show/hide timestamp toggle based on segments availability
                            const toggleBtn = document.getElementById('toggleTimestampsBtn');
                            if (window.currentSegments.length > 0) {
                                toggleBtn.classList.remove('hidden');
                            } else {
                                toggleBtn.classList.add('hidden');
                            }

                            // Update Stats
                            document.getElementById('statTime').textContent = `⏱️ ${data.data.stats.duration}s`;
                            document.getElementById('statWords').textContent = `📝 ${data.data.stats.word_count} palabras`;

                            resultContainer.classList.remove('hidden');

                            // Animate Result Entrance
                            anime({
                                targets: '.result-container',
                                translateY: [20, 0],
                                opacity: [0, 1],
                                duration: 800,
                                delay: 200,
                                easing: 'easeOutExpo'
                            });
                        }
                    } catch (e) {
                        console.error("Error parsing chunk", e);
                        if (e.message) throw e;
                    }
                }
            }

        } catch (error) {
            errorMsg.textContent = error.message || 'Ocurrió un error al transcribir el video.';
            errorMsg.classList.remove('hidden');

            // Hide pill on error
            anime({
                targets: '#statusPill',
                opacity: 0,
                duration: 300,
                easing: 'easeOutQuad',
                complete: () => {
                    statusPill.classList.add('hidden');
                }
            });
        } finally {
            transcribeBtn.classList.remove('loading');
            transcribeBtn.disabled = false;
        }
    });

    // Toggle Timestamps Display
    const toggleTimestampsBtn = document.getElementById('toggleTimestampsBtn');
    toggleTimestampsBtn.addEventListener('click', () => {
        window.showingTimestamps = !window.showingTimestamps;

        if (window.showingTimestamps) {
            // Show with timestamps
            displayWithTimestamps();
            toggleTimestampsBtn.classList.add('active');
            toggleTimestampsBtn.querySelector('span').textContent = 'Ocultar timestamps';
        } else {
            // Show plain text
            transcriptionText.textContent = transcriptionText.getAttribute('data-plain-text') || transcriptionText.textContent;
            toggleTimestampsBtn.classList.remove('active');
            toggleTimestampsBtn.querySelector('span').textContent = 'Mostrar timestamps';
        }
    });

    function displayWithTimestamps() {
        // Store plain text
        if (!transcriptionText.getAttribute('data-plain-text')) {
            transcriptionText.setAttribute('data-plain-text', transcriptionText.textContent);
        }

        // Clear and rebuild with timestamps
        transcriptionText.innerHTML = '';

        window.currentSegments.forEach(segment => {
            const segmentDiv = document.createElement('div');
            segmentDiv.className = 'timestamp-segment';

            const timestamp = document.createElement('span');
            timestamp.className = 'timestamp';
            timestamp.textContent = formatTimestamp(segment.start);

            const text = document.createElement('span');
            text.className = 'segment-text';
            text.textContent = segment.text;

            segmentDiv.appendChild(timestamp);
            segmentDiv.appendChild(text);
            transcriptionText.appendChild(segmentDiv);
        });
    }

    function formatTimestamp(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }

    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(transcriptionText.textContent)
            .then(() => {
                const tooltip = document.getElementById('copyTooltip');
                tooltip.classList.add('show');
                setTimeout(() => {
                    tooltip.classList.remove('show');
                }, 2000);
            })
            .catch(err => {
                console.error('Error al copiar: ', err);
            });
    });

    // Export as TXT
    const exportTxtBtn = document.getElementById('exportTxtBtn');
    exportTxtBtn.addEventListener('click', () => {
        const title = videoTitle.textContent || 'transcripcion';
        const text = transcriptionText.textContent;

        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sanitizeFilename(title)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // Export as SRT
    const exportSrtBtn = document.getElementById('exportSrtBtn');
    exportSrtBtn.addEventListener('click', () => {
        const title = videoTitle.textContent || 'transcripcion';
        let srtContent = '';

        // Use real segments if available, otherwise fall back to estimated
        if (window.currentSegments && window.currentSegments.length > 0) {
            window.currentSegments.forEach((segment, idx) => {
                srtContent += `${idx + 1}\n`;
                srtContent += `${formatSRTTime(segment.start)} --> ${formatSRTTime(segment.end)}\n`;
                srtContent += `${segment.text.trim()}\n\n`;
            });
        } else {
            // Fallback to estimated timestamps
            const text = transcriptionText.textContent;
            const paragraphs = text.split('\n\n').filter(p => p.trim());

            paragraphs.forEach((para, idx) => {
                const startSeconds = idx * 10;
                const endSeconds = (idx + 1) * 10;

                srtContent += `${idx + 1}\n`;
                srtContent += `${formatSRTTime(startSeconds)} --> ${formatSRTTime(endSeconds)}\n`;
                srtContent += `${para.trim()}\n\n`;
            });
        }

        const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${sanitizeFilename(title)}.srt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // Helper function to format time as SRT format
    function formatSRTTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    }

    // Helper function to sanitize filename
    function sanitizeFilename(name) {
        return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    }

    // History Feature
    const historyBtn = document.getElementById('historyBtn');
    const historyModal = document.getElementById('historyModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const historyList = document.getElementById('historyList');
    function toggleModal(show) {
        if (show) {
            historyModal.classList.remove('hidden');
            historyModal.style.setProperty('display', 'flex', 'important');
            // Small delay to allow display:flex to apply before adding active class for transition
            setTimeout(() => {
                historyModal.classList.add('active');
            }, 10);
        } else {
            historyModal.classList.remove('active');
            setTimeout(() => {
                historyModal.classList.add('hidden');
                historyModal.style.display = 'none';
            }, 300); // Match transition duration
        }
    }

    if (historyBtn) {
        historyBtn.addEventListener('click', async () => {
            try {
                const response = await fetch('/history');
                const history = await response.json();

                historyList.innerHTML = '';

                if (history.length === 0) {
                    historyList.innerHTML = '<div class="empty-history">No hay transcripciones guardadas.</div>';
                } else {
                    history.forEach(item => {
                        const el = document.createElement('div');
                        el.className = 'history-item';

                        const date = new Date(item.created_at).toLocaleDateString('es-ES', {
                            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                        });

                        el.innerHTML = `
                        <div class="history-content">
                            <div class="history-title">${item.video_title || 'Video sin título'}</div>
                            <div class="history-date">${date}</div>
                        </div>
                        <button class="delete-btn" data-id="${item.id}" title="Eliminar">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    `;

                        // Click on content to load
                        const contentDiv = el.querySelector('.history-content');
                        contentDiv.addEventListener('click', async () => {
                            // Fetch full details
                            try {
                                const detailResponse = await fetch(`/history/${item.id}`);
                                const detail = await detailResponse.json();

                                // Populate Main UI
                                videoTitle.textContent = detail.video_title;
                                transcriptionText.textContent = detail.transcription;

                                // Load segments if available
                                try {
                                    window.currentSegments = detail.segments ? JSON.parse(detail.segments) : [];
                                    window.showingTimestamps = false;

                                    const toggleBtn = document.getElementById('toggleTimestampsBtn');
                                    if (window.currentSegments.length > 0) {
                                        toggleBtn.classList.remove('hidden');
                                        toggleBtn.classList.remove('active');
                                        toggleBtn.querySelector('span').textContent = 'Mostrar timestamps';
                                    } else {
                                        toggleBtn.classList.add('hidden');
                                    }
                                } catch (e) {
                                    window.currentSegments = [];
                                }

                                // Display saved stats if available
                                if (detail.duration) {
                                    document.getElementById('statTime').textContent = `⏱️ ${detail.duration}s`;
                                } else {
                                    document.getElementById('statTime').textContent = '';
                                }

                                if (detail.word_count) {
                                    document.getElementById('statWords').textContent = `📝 ${detail.word_count} palabras`;
                                } else {
                                    document.getElementById('statWords').textContent = '';
                                }

                                resultContainer.classList.remove('hidden');

                                // Animate Result Entrance
                                anime({
                                    targets: '.result-container',
                                    translateY: [20, 0],
                                    opacity: [0, 1],
                                    duration: 800,
                                    easing: 'easeOutExpo'
                                });

                                toggleModal(false);

                            } catch (err) {
                                console.error("Error loading history item", err);
                            }
                        });

                        // Delete button handler
                        const deleteBtn = el.querySelector('.delete-btn');
                        deleteBtn.addEventListener('click', async (e) => {
                            e.stopPropagation(); // Prevent triggering the load handler

                            if (confirm('¿Estás seguro de que quieres eliminar esta transcripción?')) {
                                try {
                                    const response = await fetch(`/history/${item.id}`, {
                                        method: 'DELETE'
                                    });

                                    if (response.ok) {
                                        el.remove(); // Remove from DOM

                                        // Check if list is now empty
                                        if (historyList.querySelectorAll('.history-item').length === 0) {
                                            historyList.innerHTML = '<div class="empty-history">No hay transcripciones guardadas.</div>';
                                        }
                                    } else {
                                        alert('Error al eliminar la transcripción');
                                    }
                                } catch (err) {
                                    console.error("Error deleting history item", err);
                                    alert('Error al eliminar la transcripción');
                                }
                            }
                        });

                        historyList.appendChild(el);
                    });
                }

                toggleModal(true);

            } catch (error) {
                console.error("Error fetching history", error);
            }
        });

        closeModalBtn.addEventListener('click', () => {
            toggleModal(false);
        });

        // Close on click outside
        historyModal.addEventListener('click', (e) => {
            if (e.target === historyModal) {
                toggleModal(false);
            }
        });
    }
});

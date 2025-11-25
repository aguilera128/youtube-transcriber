document.addEventListener('DOMContentLoaded', () => {
    const videoUrlInput = document.getElementById('videoUrl');
    const transcribeBtn = document.getElementById('transcribeBtn');
    const resultContainer = document.getElementById('resultContainer');
    const videoTitle = document.getElementById('videoTitle');
    const transcriptionText = document.getElementById('transcriptionText');
    const errorMsg = document.getElementById('errorMsg');
    const copyBtn = document.getElementById('copyBtn');

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

        // Entrance Animation
        anime({
            targets: '#statusPill',
            translateY: [20, 0],
            opacity: [0, 1],
            scale: [0.9, 1],
            duration: 800,
            easing: 'easeOutElastic(1, .6)'
        });

        try {
            const response = await fetch('/transcribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url: url }),
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
                            transcriptionText.textContent = data.data.transcription;

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
});

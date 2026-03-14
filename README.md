# Speakr (Fork)

Fork of [Speakr](https://github.com/murtaza-nasir/speakr) with URL import, local LLM summarization via Ollama, and provider management.

See the original project for full documentation: [murtaza-nasir.github.io/speakr](https://murtaza-nasir.github.io/speakr)

## What this fork adds

- URL import -- paste a YouTube/Vimeo/audio URL, transcribe directly (yt-dlp)
- Local summarization -- Ollama + Qwen 2.5 7B, no data leaves your machine
- Per-user model selection -- pick which Ollama model to use from the UI
- Transcription provider settings -- switch providers from the UI without restart
- Processing stats -- token counts, timing, and cost per recording

## Architecture

Three containers, all local:

```
Speakr (Flask app)  -->  WhisperX (speech-to-text + diarization)
        |
        +------------>  Ollama (LLM for summaries, titles, chat)
```

## Requirements

- Docker and Docker Compose
- 16+ GB RAM (WhisperX + Ollama + Qwen 7B)
- HuggingFace token for pyannote diarization models (free, read-access)
  - Get one at https://huggingface.co/settings/tokens
  - Accept terms for `pyannote/speaker-diarization-3.1` and `pyannote/segmentation-3.0`

## Setup

1. Clone and enter the repo:

```
git clone https://github.com/josesiqueira/speakr-url-import.git
cd speakr-url-import
```

2. Copy and edit `.env`:

```
cp .env.example .env
```

Set at minimum:
- `HF_TOKEN` -- your HuggingFace token (required for speaker diarization)
- `ADMIN_PASSWORD` -- admin login password

The defaults use WhisperX for transcription and Ollama/Qwen for summarization. No external API keys needed.

3. Build and start:

```
docker compose build
docker compose up -d
```

4. Pull the summarization model (first time only, ~4.7 GB download):

```
docker exec ollama ollama pull qwen2.5:7b
```

5. Open `http://localhost:8899` and log in with your admin credentials.

## Usage

**Import from URL:** On the main page, paste a YouTube or video URL into the import field. The audio is downloaded, transcribed by WhisperX, and summarized by Ollama.

**Choose a model:** Go to Account > Prompt Options. The "Summarization Model" dropdown lists all models pulled into Ollama. Select one and it takes effect on the next summarization.

**Pull more models:** You can add any Ollama model and select it from the UI:

```
docker exec ollama ollama pull llama3.1:8b
docker exec ollama ollama pull mistral:7b
```

## Helper scripts

```
./start-speakr.sh     # docker compose up -d
./stop-speakr.sh      # docker compose down
./sync-upstream.sh    # fetch + merge from upstream, push to your fork
```

## Admin settings

The admin panel (`/admin`) has system settings. The ones most relevant for long recordings:

| Setting | Default | Notes |
|---|---|---|
| Transcript Length Limit | 30000 | Characters sent to LLM. Set to `-1` for no limit. |
| ASR Timeout | 1800s | Max time for transcription. Increase for long files on CPU. |
| Max File Size | 250 MB | Max upload size. |
| Default Summarization Prompt | Meeting-oriented | Edit to match your use case. |

## GPU mode (optional)

To run WhisperX on GPU, edit `docker-compose.yml`:

```yaml
whisperx:
  environment:
    - DEVICE=cuda
    - COMPUTE_TYPE=float16
    - BATCH_SIZE=16
  deploy:
    resources:
      reservations:
        devices:
          - capabilities: [gpu]
```

Requires NVIDIA GPU with 10+ GB VRAM and nvidia-container-toolkit installed.

## Syncing with upstream

This fork tracks the original Speakr repo. To pull in upstream changes:

```
./sync-upstream.sh
```

Or manually:

```
git fetch upstream
git merge upstream/master
git push origin master
```

If there are conflicts, resolve them before committing.

## License

Dual-licensed under [AGPLv3](https://www.gnu.org/licenses/agpl-3.0) and a commercial license. See the [upstream repo](https://github.com/murtaza-nasir/speakr) for full license terms.

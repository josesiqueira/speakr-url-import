# Speakr (URL Import Fork)

A fork of [Speakr](https://github.com/murtaza-nasir/speakr) — a self-hosted AI transcription and note-taking platform — with added URL import and provider management features.

## What This Fork Adds

- **URL Import** — Paste a YouTube, Vimeo, or other video/audio URL and transcribe it directly (powered by yt-dlp)
- **Transcription Provider Settings** — Switch providers (OpenAI, Whisper, Local ASR, Azure) from the UI without restarting
- **Provider Badges** — See which provider/model processed each recording at a glance
- **Upload Confirmation** — Transparency step showing the active provider before any API call
- **Processing Stats** — Token counts, timing, and estimated cost per recording

## Running

```bash
# Start
./start-speakr.sh

# Stop
./stop-speakr.sh

# Open http://localhost:8899
```

## Setup

1. Copy `.env` from the upstream example and configure your API keys:
   - `TRANSCRIPTION_API_KEY` — For speech-to-text (OpenAI) or set `ASR_BASE_URL` for self-hosted
   - `TEXT_MODEL_API_KEY` — For summaries, titles, and chat

2. Run with Docker:
   ```bash
   docker compose up -d
   ```

## Keeping Up to Date

```bash
# Add upstream remote (once)
git remote add upstream https://github.com/murtaza-nasir/speakr.git

# Sync
./sync-upstream.sh
```

## Documentation

For all other features, configuration, admin guide, and troubleshooting, see the upstream documentation:

**[murtaza-nasir.github.io/speakr](https://murtaza-nasir.github.io/speakr)**

## License

This project is **dual-licensed**:

1.  **GNU Affero General Public License v3.0 (AGPLv3)**
    [![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

    Speakr is offered under the AGPLv3 as its open-source license. You are free to use, modify, and distribute this software under the terms of the AGPLv3. A key condition of the AGPLv3 is that if you run a modified version on a network server and provide access to it for others, you must also make the source code of your modified version available to those users under the AGPLv3.

    * You **must** create a file named `LICENSE` (or `COPYING`) in the root of your repository and paste the full text of the [GNU AGPLv3 license](https://www.gnu.org/licenses/agpl-3.0.txt) into it.
    * Read the full license text carefully to understand your rights and obligations.

2.  **Commercial License**

    For users or organizations who cannot or do not wish to comply with the terms of the AGPLv3 (for example, if you want to integrate Speakr into a proprietary commercial product or service without being obligated to share your modifications under AGPLv3), a separate commercial license is available.

    Please contact **speakr maintainers** for details on obtaining a commercial license.

**You must choose one of these licenses** under which to use, modify, or distribute this software. If you are using or distributing the software without a commercial license agreement, you must adhere to the terms of the AGPLv3.

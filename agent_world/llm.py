import json
import requests
from config import OLLAMA_URL, MODEL_NAME, TEMPERATURE, MAX_TOKENS, SUMMARY_MAX_TOKENS


def get_agent_action(system_prompt: str, user_prompt: str) -> dict:
    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model": MODEL_NAME,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                "format": "json",
                "stream": False,
                "options": {
                    "temperature": TEMPERATURE,
                    "num_predict": MAX_TOKENS,
                },
            },
            timeout=30,
        )
        response.raise_for_status()
        result = response.json()
        raw = result.get("message", {}).get("content", "")
        return json.loads(raw)
    except requests.exceptions.ConnectionError:
        print(f"[LLM ERROR] Cannot connect to Ollama at {OLLAMA_URL}. Is it running?")
        raise SystemExit(1)
    except requests.exceptions.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            print(f"[LLM ERROR] Model '{MODEL_NAME}' not found. Run: ollama pull {MODEL_NAME}")
            raise SystemExit(1)
        print(f"[LLM ERROR] HTTP {e.response.status_code if e.response else '?'}: {e}")
        return {"action": "wait"}
    except (json.JSONDecodeError, KeyError) as e:
        print(f"[LLM WARN] Failed to parse JSON response: {e}")
        return {"action": "wait"}


def compress_journal(prompt: str) -> str:
    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL_NAME,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.5,
                    "num_predict": SUMMARY_MAX_TOKENS,
                },
            },
            timeout=30,
        )
        response.raise_for_status()
        return response.json().get("response", "").strip()
    except requests.exceptions.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            print(f"[LLM ERROR] Model '{MODEL_NAME}' not found. Run: ollama pull {MODEL_NAME}")
            raise SystemExit(1)
        print(f"[LLM WARN] Journal compression failed: {e}")
        return ""
    except Exception as e:
        print(f"[LLM WARN] Journal compression failed: {e}")
        return ""

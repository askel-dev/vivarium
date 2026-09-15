import json
import requests
from config import OLLAMA_URL, MODEL_NAME, TEMPERATURE, MAX_TOKENS, SUMMARY_MAX_TOKENS


def _normalize_action_response(action_data: dict) -> dict:
    action = action_data.get("action")
    if not action:
        return action_data

    if isinstance(action, dict):
        action_type = action.get("type")
        if action_type:
            normalized = {key: value for key, value in action_data.items() if key != "action"}
            normalized[action_type] = {
                key: value for key, value in action.items() if key != "type"
            }
            return normalized
    elif isinstance(action, str):
        normalized = {key: value for key, value in action_data.items() if key not in ("action", "direction")}
        normalized[action] = {"direction": action_data["direction"]} if "direction" in action_data else {}
        return normalized

    return action_data


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
                "think": False,
                "options": {
                    "temperature": TEMPERATURE,
                    "num_predict": MAX_TOKENS,
                },
            },
            timeout=120,
        )
        response.raise_for_status()
        result = response.json()
        raw = result.get("message", {}).get("content", "")
        return _normalize_action_response(json.loads(raw))
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


def narrate(prompt: str, max_tokens: int, temperature: float = 0.9) -> str:
    """
    Generate free prose from the local model.

    Same endpoint as compress_journal, but with a caller-supplied token budget
    and a higher default temperature — this is storytelling, not summarising.
    """
    try:
        response = requests.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model": MODEL_NAME,
                "prompt": prompt,
                "stream": False,
                "think": False,
                "options": {
                    "temperature": temperature,
                    "num_predict": max_tokens,
                },
            },
            timeout=300,
        )
        response.raise_for_status()
        return response.json().get("response", "").strip()
    except requests.exceptions.ConnectionError:
        print(f"[STORY] Cannot connect to Ollama at {OLLAMA_URL}.")
        return ""
    except Exception as e:
        print(f"[STORY] Narration failed: {e}")
        return ""


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
            timeout=120,
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

from config import WHISPER_RANGE, TALK_RANGE, SHOUT_RANGE

VOLUME_RANGES = {
    "whisper": WHISPER_RANGE,
    "talk": TALK_RANGE,
    "shout": SHOUT_RANGE,
}


def deliver_speech(speaker, world, event_log: list, log=None, tick=0):
    """Deliver pending speech from an agent to all agents in range."""
    if not hasattr(speaker, "_pending_speech_out"):
        return
    message, volume = speaker._pending_speech_out
    del speaker._pending_speech_out

    speech_event = f"{speaker.name} {volume}s: '{message}'"
    event_log.append(speech_event)

    max_dist = VOLUME_RANGES.get(volume, TALK_RANGE)
    heard_by = []
    for agent in world.agents:
        if agent is speaker:
            continue
        dist = abs(agent.x - speaker.x) + abs(agent.y - speaker.y)
        if dist <= max_dist:
            if not hasattr(agent, "_pending_speech"):
                agent._pending_speech = []
            agent._pending_speech.append(speech_event)
            agent.add_to_working_memory(speech_event)
            heard_by.append(agent.name)

    if log is not None:
        log.log_speech(speaker.name, tick, message, volume, heard_by)


def clear_pending_speech(world):
    """Clear pending speech lists after perception is built."""
    for agent in world.agents:
        if hasattr(agent, "_pending_speech"):
            del agent._pending_speech


def clear_agent_pending_speech(agent):
    """Clear pending speech for a single agent after their perception is built."""
    if hasattr(agent, "_pending_speech"):
        del agent._pending_speech

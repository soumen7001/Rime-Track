"""
Rime TTS Voice Agent
====================
A real-time Python voice agent using the Rime TTS API.

Key Features:
- Uses Rime TTS with the 'wawona' voice on the 'coda' model.
- Low-latency real-time audio streaming (WebSocket /ws3 & HTTP L16 PCM).
- Direct-to-speaker playback using sounddevice RawOutputStream.
- Secure credential management via RIME_API_KEY environment variable.
- Interactive terminal voice assistant loop with conversational capability.
"""

import argparse
import asyncio
import base64
import json
import os
import sys
import time
from typing import AsyncGenerator, Generator, Optional

import requests
import sounddevice as sd
from dotenv import load_dotenv

# Load environment variables without exposing sensitive values
load_dotenv()

from tools.agent_memory import memory


class RimeVoiceAgent:
    """
    Voice Agent powered by Rime's ultra-low latency TTS API.
    Configured with model 'coda' and speaker 'wawona'.
    """

    DEFAULT_MODEL = "coda"
    DEFAULT_SPEAKER = "wawona"
    DEFAULT_SAMPLE_RATE = 24000
    WS_URL = "wss://users-ws.rime.ai/ws3"
    HTTP_URL = "https://users.rime.ai/v1/rime-tts"

    def __init__(
        self,
        speaker: str = DEFAULT_SPEAKER,
        model_id: str = DEFAULT_MODEL,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        api_key: Optional[str] = None,
    ):
        self.speaker = speaker
        self.model_id = model_id
        self.sample_rate = sample_rate
        # Read API key strictly from environment variable or passed parameter; never log or print it
        self._api_key = api_key or os.getenv("RIME_API_KEY")
        if not self._api_key or self._api_key.strip() in ("", "your-rime-api-key"):
            raise ValueError(
                "RIME_API_KEY is not set. Please set the RIME_API_KEY environment variable in your .env or system environment."
            )

    async def stream_and_play_ws(self, text: str) -> None:
        """
        Stream audio via Rime WebSocket (/ws3) and play back in real-time.
        Emits timestamps and base64 PCM audio chunks with sub-200ms time-to-first-audio.
        """
        import websockets

        ws_url = (
            f"{self.WS_URL}?"
            f"speaker={self.speaker}&"
            f"modelId={self.model_id}&"
            f"audioFormat=pcm&"
            f"samplingRate={self.sample_rate}"
        )
        headers = {"Authorization": f"Bearer {self._api_key}"}

        print(f"\n[RIME TTS] Synthesizing with voice '{self.speaker}' (model: '{self.model_id}') via WebSocket...")
        t_start = time.perf_counter()
        first_chunk_received = False
        first_byte_latency_ms = 0.0

        # Create low-latency raw audio output stream
        audio_stream = sd.RawOutputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="int16",
        )
        audio_stream.start()

        remainder = b""
        total_pcm_bytes = 0

        try:
            async with websockets.connect(ws_url, additional_headers=headers) as ws:
                # Send text for synthesis and signal end of stream
                await ws.send(json.dumps({"text": text}))
                await ws.send(json.dumps({"operation": "eos"}))

                async for raw_message in ws:
                    event = json.loads(raw_message)
                    event_type = event.get("type")

                    if event_type == "chunk":
                        if not first_chunk_received:
                            first_chunk_received = True
                            first_byte_latency_ms = (time.perf_counter() - t_start) * 1000.0
                            print(f"[RIME STREAM] First audio chunk received in {first_byte_latency_ms:.2f} ms")

                        raw_chunk = remainder + base64.b64decode(event["data"])
                        # 16-bit PCM requires samples to be even (2 bytes per sample)
                        valid_len = len(raw_chunk) - (len(raw_chunk) % 2)
                        if valid_len > 0:
                            audio_stream.write(raw_chunk[:valid_len])
                            total_pcm_bytes += valid_len
                        remainder = raw_chunk[valid_len:]

                    elif event_type == "timestamps":
                        words = event.get("word_timestamps", {}).get("words", [])
                        print(f"[RIME TIMESTAMPS] Spoken words: {' '.join(words)}")

                    elif event_type == "done":
                        break

                    elif event_type == "error":
                        print(f"[RIME ERROR] Server error: {event.get('message')}")
                        break

            # Flush any remaining byte
            if remainder:
                audio_stream.write(remainder + b"\x00")
                total_pcm_bytes += 2

            # Brief pause to allow sound buffer to finish playing through hardware
            await asyncio.sleep(0.4)

        finally:
            audio_stream.stop()
            audio_stream.close()

        total_time = (time.perf_counter() - t_start) * 1000.0
        print(f"[RIME PLAYBACK] Completed playback ({total_pcm_bytes} PCM bytes in {total_time:.2f} ms)")

    def stream_and_play_http(self, text: str) -> None:
        """
        Stream audio via Rime HTTP endpoint (/v1/rime-tts) using audio/L16 (linear PCM)
        and play incrementally as chunks arrive.
        """
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "audio/L16",
        }
        payload = {
            "speaker": self.speaker,
            "modelId": self.model_id,
            "text": text,
            "samplingRate": self.sample_rate,
        }

        print(f"\n[RIME TTS] Synthesizing with voice '{self.speaker}' (model: '{self.model_id}') via HTTP Stream...")
        t_start = time.perf_counter()
        first_chunk_received = False

        audio_stream = sd.RawOutputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="int16",
        )
        audio_stream.start()

        remainder = b""
        total_pcm_bytes = 0

        try:
            with requests.post(self.HTTP_URL, headers=headers, json=payload, stream=True) as response:
                response.raise_for_status()

                for chunk in response.iter_content(chunk_size=2048):
                    if chunk:
                        if not first_chunk_received:
                            first_chunk_received = True
                            first_byte_latency_ms = (time.perf_counter() - t_start) * 1000.0
                            print(f"[RIME STREAM] First audio chunk received in {first_byte_latency_ms:.2f} ms")

                        raw_chunk = remainder + chunk
                        valid_len = len(raw_chunk) - (len(raw_chunk) % 2)
                        if valid_len > 0:
                            audio_stream.write(raw_chunk[:valid_len])
                            total_pcm_bytes += valid_len
                        remainder = raw_chunk[valid_len:]

            if remainder:
                audio_stream.write(remainder + b"\x00")
                total_pcm_bytes += 2

            time.sleep(0.4)

        finally:
            audio_stream.stop()
            audio_stream.close()

        total_time = (time.perf_counter() - t_start) * 1000.0
        print(f"[RIME PLAYBACK] Completed playback ({total_pcm_bytes} PCM bytes in {total_time:.2f} ms)")

    async def speak(self, text: str, use_ws: bool = True) -> None:
        """Speak the given text out loud using low-latency streaming."""
        if use_ws:
            await self.stream_and_play_ws(text)
        else:
            self.stream_and_play_http(text)


def generate_agent_response(user_prompt: str, last_agent_reply: Optional[str] = None) -> str:
    """
    Conversational response generator with continuous learning from user feedback and mistakes.
    Uses Groq LLM when GROQ_API_KEY is available and incorporates active memory context.
    """
    prompt_lower = user_prompt.strip().lower()

    if not prompt_lower:
        return "Hello! How can I assist you today?"

    # 1. Check for correction or active learning trigger
    learning_feedback = memory.detect_and_learn(user_prompt, last_agent_reply)
    if learning_feedback:
        return learning_feedback

    # 2. Retrieve persistent memory & past corrections context
    memory_context = memory.get_memory_context()

    # 3. Check for Groq LLM for dynamic AI reasoning
    groq_key = os.getenv("GROQ_API_KEY")
    if groq_key and groq_key != "your-groq-api-key" and len(groq_key.strip()) > 10:
        try:
            from groq import Groq
            client = Groq(api_key=groq_key)

            system_prompt = (
                "You are Aegis Medic, an ultra-responsive emergency clinical voice agent powered by Rime TTS. "
                "Your mission is emergency trauma care, patient triage, clinical medication calculations, and Rime voice streaming operations.\n"
                "CRITICAL OUT-OF-SCOPE REDIRECTION POLICY: "
                "If the user asks about an unrelated topic outside trauma care, medicine, dosage calculations, or Rime voice protocols (e.g. sports, movies, cooking recipes, politics, cryptocurrency, or unrelated trivia), "
                "politely inform the user that this topic is outside your clinical and voice mission scope, and guide them back to patient care or voice controls.\n"
                "Deliver direct, natural, conversational responses in 1 to 2 spoken sentences without markdown, bullet points, asterisks, or visual lists.\n"
            )
            if memory_context:
                system_prompt += f"\nActive Memory & Learned Rules (Respect and strictly follow these):\n{memory_context}\n"

            completion = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                model="qwen/qwen3.8-27b",
                max_tokens=60,
                temperature=0.3,
            )
            reply = completion.choices[0].message.content.strip()
            if reply:
                return reply
        except Exception as err:
            pass

    # 4. Secondary OpenAI LLM Fallback
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key and openai_key != "your-openai-api-key" and len(openai_key.strip()) > 10:
        try:
            from openai import OpenAI
            client_oa = OpenAI(api_key=openai_key)
            completion_oa = client_oa.chat.completions.create(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                model="gpt-4o-mini",
                max_tokens=60,
                temperature=0.3,
            )
            reply_oa = completion_oa.choices[0].message.content.strip()
            if reply_oa:
                return reply_oa
        except Exception as err:
            pass

    # Rule-based fallback (incorporating user facts)
    user_name = memory.memories.get("user_facts", {}).get("user_name")
    if "who are you" in prompt_lower or "what are you" in prompt_lower:
        greeting = f"Hello {user_name}! " if user_name else ""
        return f"{greeting}I am an ultra-responsive Python voice agent, powered by Rime's Coda speech model with the Wawona voice."
    elif "who am i" in prompt_lower or "what is my name" in prompt_lower:
        if user_name:
            return f"You told me your name is {user_name}."
        return "You haven't told me your name yet! You can say 'My name is ...' and I will remember it."
    elif "how are you" in prompt_lower:
        return "I am doing great! Ready to stream crisp, natural speech with low latency."
    elif "time" in prompt_lower:
        current_time = time.strftime("%I:%M %p")
        return f"The current local time is {current_time}."
    elif "bye" in prompt_lower or "exit" in prompt_lower or "quit" in prompt_lower:
        return "Goodbye! Have a wonderful day."

    # Out of scope domain boundary check for fallback
    medical_or_system_keywords = [
        "medic", "dose", "mg", "kg", "patient", "trauma", "epi", "fentanyl", "morphine", "ketamine",
        "bleeding", "burn", "cpr", "txa", "paracetamol", "tylenol", "drug", "iv", "im", "infusion",
        "airway", "breath", "pressure", "bp", "cardiac", "rime", "coda", "wawona", "voice", "stream",
        "latency", "speech", "hello", "hi", "hey"
    ]
    if not any(k in prompt_lower for k in medical_or_system_keywords):
        return "I specialize in tactical emergency medical support, trauma triage, and Rime voice operations. That topic falls outside my clinical scope. How can I assist you with your patient or voice protocols today?"

    return f"For {user_prompt.strip()}: initiate primary ABC survey and specify if you require medication dosing or trauma protocol guidance."


async def run_interactive_mode(agent: RimeVoiceAgent, use_ws: bool = True) -> None:
    """Run an interactive conversational loop in the terminal with continuous learning."""
    print("=" * 70)
    print("  RIME TTS VOICE AGENT (Voice: wawona | Model: coda)")
    print("  Interactive Mode: Active learning & memory enabled.")
    print("  Type a prompt to hear the agent speak out loud, or 'exit' to quit.")
    print("=" * 70)

    # Initial greeting spoken out loud
    welcome_text = "Hello! I am your Rime voice agent using the wawona voice on the coda model. How can I help you today?"
    print(f"\nAgent: {welcome_text}")
    await agent.speak(welcome_text, use_ws=use_ws)

    last_agent_reply = welcome_text

    while True:
        try:
            user_input = input("\nYou: ").strip()
            if not user_input:
                continue
            if user_input.lower() in ("exit", "quit", "q"):
                farewell = "Goodbye! Thank you for using Rime TTS."
                print(f"Agent: {farewell}")
                await agent.speak(farewell, use_ws=use_ws)
                break

            response = generate_agent_response(user_input, last_agent_reply=last_agent_reply)
            print(f"Agent: {response}")
            await agent.speak(response, use_ws=use_ws)
            last_agent_reply = response

        except (KeyboardInterrupt, EOFError):
            print("\nExiting voice agent...")
            break
            break


async def main():
    parser = argparse.ArgumentParser(description="Rime TTS Python Voice Agent")
    parser.add_argument(
        "--text",
        type=str,
        default="Hello from Rime! I am speaking using the wawona voice on the coda model.",
        help="Text for the voice agent to speak immediately",
    )
    parser.add_argument(
        "--interactive",
        "-i",
        action="store_true",
        help="Start an interactive conversation loop in the terminal",
    )
    parser.add_argument(
        "--speaker",
        type=str,
        default=RimeVoiceAgent.DEFAULT_SPEAKER,
        help="Speaker voice (default: wawona)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=RimeVoiceAgent.DEFAULT_MODEL,
        help="TTS Model (default: coda)",
    )
    parser.add_argument(
        "--transport",
        choices=["ws", "http"],
        default="ws",
        help="Streaming transport: 'ws' (WebSocket /ws3) or 'http' (HTTP /v1/rime-tts)",
    )

    args = parser.parse_args()

    agent = RimeVoiceAgent(
        speaker=args.speaker,
        model_id=args.model,
    )

    use_ws = args.transport == "ws"

    if args.interactive:
        await run_interactive_mode(agent, use_ws=use_ws)
    else:
        print(f"Voice Agent speaking: \"{args.text}\"")
        await agent.speak(args.text, use_ws=use_ws)


if __name__ == "__main__":
    asyncio.run(main())

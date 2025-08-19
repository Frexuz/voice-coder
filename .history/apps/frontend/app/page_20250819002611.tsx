// apps/frontend/app/page.tsx

"use client";

import { useRef, useState, useEffect } from "react";
import { Mic, Send } from "lucide-react";

type Status = "idle" | "listening" | "sending" | "waiting" | "done" | "error";

function getWSUrl() {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  return `ws://${host}:4000/ws`;
}

export default function Home() {
  const [status, setStatus] = useState<Status>("idle");
  const [transcript, setTranscript] = useState<string>("");
  const [reply, setReply] = useState<string>("");
  const [input, setInput] = useState<string>("");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [supportsSpeech, setSupportsSpeech] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);
  const idRef = useRef<string>("");

  // Check for Web Speech API support
  useEffect(() => {
    setSupportsSpeech(
      typeof window !== "undefined" &&
        ("webkitSpeechRecognition" in window || "SpeechRecognition" in window)
    );
  }, []);

  // WebSocket setup
  useEffect(() => {
    if (!ws) {
      const socket = new WebSocket(getWSUrl());
      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "hello" }));
      };
      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "ack") {
          setStatus("waiting");
        } else if (msg.type === "reply") {
          setReply(msg.text);
          setStatus("done");
        } else if (msg.type === "error") {
          setStatus("error");
        }
      };
      socket.onerror = () => setStatus("error");
      socket.onclose = () => setWs(null);
      setWs(socket);
    }
    return () => {
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws]);

  // SpeechRecognition handlers
  const handleMicDown = () => {
    if (!supportsSpeech) return;
    setStatus("listening");
    setTranscript("");
    setReply("");
    idRef.current = Math.random().toString(36).slice(2);
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      setTranscript(text);
      sendPrompt(text);
    };
    recognition.onerror = () => setStatus("error");
    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleMicUp = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      setStatus("sending");
    }
  };

  // Send prompt via WS or fallback to POST
  const sendPrompt = async (text: string) => {
    setStatus("sending");
    setTranscript(text);
    setReply("");
    idRef.current = Math.random().toString(36).slice(2);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "prompt", id: idRef.current, text }));
    } else {
      // Fallback to POST
      try {
        const res = await fetch("/api/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const data = await res.json();
        setReply(data.text);
        setStatus("done");
      } catch {
        setStatus("error");
      }
    }
  };

  // Text input fallback
  const handleSend = () => {
    if (!input.trim()) return;
    setTranscript(input);
    sendPrompt(input);
    setInput("");
  };

  return (
    <main className="flex flex-col justify-center items-center bg-gray-50 px-4 min-h-screen">
      <div className="space-y-6 w-full max-w-md">
        <h1 className="mb-2 font-bold text-2xl text-center">
          Voice-to-CLI PoC
        </h1>
        <div className="flex flex-col items-center space-y-2">
          {supportsSpeech ? (
            <button
              className={`w-20 h-20 rounded-full bg-blue-600 text-white flex items-center justify-center text-4xl shadow-lg active:bg-blue-800 transition-all`}
              onPointerDown={handleMicDown}
              onPointerUp={handleMicUp}
              aria-label="Hold to Talk"
            >
              <Mic size={48} />
            </button>
          ) : (
            <button
              className="flex justify-center items-center bg-gray-400 shadow-lg rounded-full w-20 h-20 text-white text-4xl cursor-not-allowed"
              disabled
              aria-label="Mic unavailable"
            >
              <Mic size={48} />
            </button>
          )}
          <span className="mt-2 font-medium text-lg">
            {supportsSpeech ? "Hold to Talk" : "Mic unavailable"}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <input
            type="text"
            className="flex-1 px-3 py-2 border border-gray-300 rounded"
            placeholder="Type here if mic unavailable"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={status === "listening"}
          />
          <button
            className="bg-blue-600 p-2 rounded text-white"
            onClick={handleSend}
            disabled={!input.trim() || status === "listening"}
            aria-label="Send"
          >
            <Send size={24} />
          </button>
        </div>
        <div className="space-y-2 mt-4">
          <div className="bg-white shadow p-3 rounded">
            <span className="font-semibold">You said:</span>{" "}
            {transcript ? transcript : <span className="text-gray-400">—</span>}
          </div>
          <div className="bg-white shadow p-3 rounded">
            <span className="font-semibold">Agent reply:</span>{" "}
            {reply ? reply : <span className="text-gray-400">—</span>}
          </div>
        </div>
        <div className="mt-4 text-gray-500 text-sm text-center">
          Status:{" "}
          {
            {
              idle: "Idle",
              listening: "Listening…",
              sending: "Sending…",
              waiting: "Waiting…",
              done: "Done",
              error: "Error",
            }[status]
          }
        </div>
      </div>
    </main>
  );
}

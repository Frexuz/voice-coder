import type {
    SpeechErrorEvent,
    SpeechResultsEvent,
} from "@react-native-voice/voice";
import Voice from "@react-native-voice/voice";
import { useCallback, useEffect, useRef, useState } from "react";

export type UseSpeech = {
	canUse: boolean;
	isListening: boolean;
	error?: string;
	onMicDown: () => void;
	onMicUp: () => void;
};

export default function useSpeech(
	onRecognized: (text: string) => void,
): UseSpeech {
	const [isListening, setIsListening] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	// Track whether we got any speech in this session
	const gotSpeechRef = useRef(false);
	// Accumulate the latest recognized text (partial or final)
	const bufferRef = useRef("");
	// Prevent multiple emits per session
	const emittedRef = useRef(false);

	useEffect(() => {
		return () => {
			try {
				Voice.removeAllListeners();
				Voice.destroy().catch(() => {});
			} catch {}
		};
	}, []);

	const finalizeOnce = useCallback(() => {
		if (emittedRef.current) return;
		const text = bufferRef.current.trim();
		if (text) {
			emittedRef.current = true;
			onRecognized(text);
		}
	}, [onRecognized]);

	const onMicDown = useCallback(() => {
		setError(undefined);
		setIsListening(true);
		gotSpeechRef.current = false;
		emittedRef.current = false;
		bufferRef.current = "";
		try {
			Voice.removeAllListeners();
			Voice.onSpeechError = (e: SpeechErrorEvent) => {
				const msg = e?.error?.message || "Speech error";
				setError(msg);
				setIsListening(false);
			};
			// Buffer interim and final results; don't emit here
			const handlePartial = (e: SpeechResultsEvent) => {
				const val = e?.value;
				const text = (Array.isArray(val) && val[0]) || "";
				if (typeof text === "string") bufferRef.current = text;
			};
			Voice.onSpeechPartialResults =
				handlePartial as unknown as typeof Voice.onSpeechPartialResults;
			Voice.onSpeechResults = (e: SpeechResultsEvent) => {
				const val = e?.value;
				const text = (Array.isArray(val) && val[0]) || "";
				if (text && String(text).trim()) {
					gotSpeechRef.current = true;
					bufferRef.current = String(text);
				}
			};
			Voice.onSpeechEnd = () => {
				// Recognition session ended; emit once if we have text
				setIsListening(false);
				finalizeOnce();
			};
			Voice.start("en-US");
		} catch (err: unknown) {
			const msg =
				err && typeof err === "object" && "message" in err
					? String(
							(err as { message?: string }).message || "Failed to start voice",
						)
					: "Failed to start voice";
			setError(msg);
			setIsListening(false);
		}
	}, [finalizeOnce]);

	const onMicUp = useCallback(() => {
		// Stop will trigger onSpeechEnd, which finalizes once
		Voice.stop().catch(() => {
			// Fallback finalize if stop fails
			finalizeOnce();
			setIsListening(false);
		});
	}, [finalizeOnce]);

	return { canUse: true, isListening, error, onMicDown, onMicUp };
}

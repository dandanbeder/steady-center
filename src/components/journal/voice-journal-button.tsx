import { useRef, useState } from "react";
import { Mic, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { transcribeAudio } from "@/lib/transcribe.functions";

type Props = {
  onTranscribed: (text: string) => void;
};

export function VoiceJournalButton({ onTranscribed }: Props) {
  const transcribe = useServerFn(transcribeAudio);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const start = async () => {
    if (recording || busy) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error("Microphone access is needed to record.");
      return;
    }
    const mimeType = ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) {
      stream.getTracks().forEach((t) => t.stop());
      toast.error("This browser can't record a supported audio format.");
      return;
    }
    streamRef.current = stream;
    const rec = new MediaRecorder(stream, { mimeType });
    chunksRef.current = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = async () => {
      stopTracks();
      const blob = new Blob(chunksRef.current, { type: rec.mimeType });
      chunksRef.current = [];
      if (blob.size < 1024) {
        toast.error("That recording was empty — try again.");
        return;
      }
      setBusy(true);
      try {
        const buf = await blob.arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buf);
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        const audio_base64 = btoa(binary);
        const { text } = await transcribe({ data: { audio_base64, mime: rec.mimeType } });
        if (!text) {
          toast.error("Couldn't hear anything in that recording.");
          return;
        }
        onTranscribed(text);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Transcription failed");
      } finally {
        setBusy(false);
      }
    };
    rec.start();
    recorderRef.current = rec;
    setRecording(true);
  };

  const stop = () => {
    try {
      recorderRef.current?.stop();
    } catch {
      stopTracks();
    }
    recorderRef.current = null;
    setRecording(false);
  };

  return (
    <Button
      type="button"
      size="sm"
      variant={recording ? "default" : "ghost"}
      onClick={recording ? stop : start}
      disabled={busy}
      className="gap-1.5"
      title={recording ? "Stop recording" : "Voice to journal"}
    >
      {busy ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing…
        </>
      ) : recording ? (
        <>
          <Square className="h-3.5 w-3.5" /> Stop
        </>
      ) : (
        <>
          <Mic className="h-3.5 w-3.5" /> Voice
        </>
      )}
    </Button>
  );
}

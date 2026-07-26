import React, { useEffect, useRef } from "react";
import { DroneScene } from "../three/droneScene.js";

/**
 * The 3D window. All heavy lifting lives in DroneScene (plain three.js); this
 * component only pushes React state into it and hands the instance back up so the
 * parts tray can start a drag.
 */
export default function Viewport({
  mode,
  frameId,
  placed,
  activePart,
  filledSlots,
  telemetry,
  env,
  fcTone,
  onPlace,
  onSceneReady,
  children,
}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);

  /* Create once. */
  useEffect(() => {
    const scene = new DroneScene(canvasRef.current, wrapRef.current);
    sceneRef.current = scene;
    onSceneReady?.(scene);
    // Dev-only handle so the scene can be inspected from the browser console.
    if (import.meta.env.DEV) window.__droneLabScene = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Placement callback must always point at the latest handler. */
  useEffect(() => {
    if (sceneRef.current) sceneRef.current.onPlace = onPlace;
  }, [onPlace]);

  useEffect(() => {
    sceneRef.current?.setFrame(frameId);
  }, [frameId]);

  useEffect(() => {
    sceneRef.current?.syncBuild(placed);
  }, [placed, frameId]);

  useEffect(() => {
    sceneRef.current?.setActiveTarget(activePart, filledSlots);
  }, [activePart, filledSlots, frameId]);

  useEffect(() => {
    sceneRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    sceneRef.current?.setEnvironment(env);
  }, [env]);

  useEffect(() => {
    sceneRef.current?.setFcTone(fcTone);
  }, [fcTone]);

  /* Telemetry arrives ~15 times a second; the scene interpolates between frames. */
  useEffect(() => {
    sceneRef.current?.setTelemetry(telemetry);
  }, [telemetry]);

  return (
    <div className="viewport" ref={wrapRef}>
      <canvas ref={canvasRef} style={{ cursor: mode === "assembly" ? "grab" : "default" }} />
      {children}
    </div>
  );
}

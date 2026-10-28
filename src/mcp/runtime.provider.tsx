import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useLocalStorageState } from "ahooks";

import type { Permission } from "@/application/types";
import { useWorkspace } from "@/contexts/workspace";
import { createLogger } from "@/lib/logger";
import { buildMcpManifest } from "./manifest";
import { isPermission } from "./permissions";
import {
  EMPTY_MCP_STATUS,
  McpRuntimeContext,
  type McpRuntimeContextValue,
  type McpRuntimePhase,
  type McpServerStatus,
} from "./runtime";

const log = createLogger("McpRuntime");
const ACCESS_KEY = "novels-yes:mcp-access-level";

export function McpRuntimeProvider({ children }: { children: ReactNode }) {
  const { root } = useWorkspace();
  const [storedAccess, setStoredAccess] = useLocalStorageState<Permission>(
    ACCESS_KEY,
    { defaultValue: "read" }
  );
  const accessLevel = isPermission(storedAccess) ? storedAccess : "read";
  const [status, setStatus] = useState<McpServerStatus>({
    ...EMPTY_MCP_STATUS,
    accessLevel,
  });
  const [phase, setPhase] = useState<McpRuntimePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const lifecycle = useRef<Promise<void>>(Promise.resolve());

  const enqueueLifecycle = useCallback(
    <T,>(operation: () => Promise<T>): Promise<T> => {
      const next = lifecycle.current.catch(() => undefined).then(operation);
      lifecycle.current = next.then(
        () => undefined,
        () => undefined
      );
      return next;
    },
    []
  );

  const start = useCallback(
    (options?: {
      rotateToken?: boolean;
      accessLevel?: Permission;
    }): Promise<McpServerStatus | null> => {
      if (!root) {
        setPhase("idle");
        return Promise.resolve(null);
      }
      const nextAccess = options?.accessLevel ?? accessLevel;
      const requestGeneration = ++generation.current;
      setPhase("starting");
      setError(null);
      return enqueueLifecycle(async () => {
        try {
          const next = await invoke<McpServerStatus>("mcp_start", {
            request: {
              root,
              manifest: buildMcpManifest(nextAccess),
              rotateToken: options?.rotateToken ?? false,
            },
          });
          if (requestGeneration !== generation.current) return next;
          setStatus(next);
          setPhase("ready");
          log.info("MCP ready", {
            endpoint: next.endpoint,
            accessLevel: next.accessLevel,
            tools: next.toolCount,
          });
          return next;
        } catch (err) {
          if (requestGeneration !== generation.current) return null;
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
          setPhase("degraded");
          log.error("MCP start failed", err);
          return null;
        }
      });
    },
    [accessLevel, enqueueLifecycle, root]
  );

  const stop = useCallback(async () => {
    generation.current += 1;
    setStatus({ ...EMPTY_MCP_STATUS, accessLevel });
    setPhase(root ? "stopped" : "idle");
    return enqueueLifecycle(async () => {
      try {
        await invoke("mcp_stop");
      } catch (err) {
        log.warn("MCP stop failed", err);
      }
    });
  }, [accessLevel, enqueueLifecycle, root]);

  const restart = useCallback(async () => {
    await stop();
    return start();
  }, [start, stop]);

  const setAccessLevel = useCallback(
    async (permission: Permission) => {
      setStoredAccess(permission);
      setStatus((current) => ({ ...current, accessLevel: permission }));
      if (!root) return;
      try {
        const next = await enqueueLifecycle(() =>
          invoke<McpServerStatus>("mcp_configure", {
            request: { manifest: buildMcpManifest(permission) },
          })
        );
        setStatus(next);
        setPhase("ready");
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setPhase("degraded");
        log.error("MCP configure failed", err);
      }
    },
    [enqueueLifecycle, root, setStoredAccess]
  );

  const rotateToken = useCallback(async () => {
    return start({ rotateToken: true });
  }, [start]);

  useEffect(() => {
    if (!root) {
      void stop();
      return;
    }
    void start();
    return () => {
      generation.current += 1;
      void enqueueLifecycle(() => invoke("mcp_stop").catch(() => undefined));
    };
    // start already tracks the current root and permission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  useEffect(() => {
    if (!root || phase !== "ready") return;
    const timer = window.setInterval(() => {
      invoke<McpServerStatus>("mcp_status")
        .then((next) => setStatus(next))
        .catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [phase, root]);

  useEffect(() => {
    if (!root) return;
    let disposed = false;
    const unlisten = listen("mcp:clients-changed", () => {
      void invoke<McpServerStatus>("mcp_status")
        .then((next) => {
          if (!disposed) setStatus(next);
        })
        .catch(() => undefined);
    });
    return () => {
      disposed = true;
      void unlisten.then((fn) => fn());
    };
  }, [root]);

  const value = useMemo<McpRuntimeContextValue>(
    () => ({
      status,
      phase,
      error,
      accessLevel,
      start,
      stop,
      restart,
      setAccessLevel,
      rotateToken,
    }),
    [
      accessLevel,
      error,
      phase,
      restart,
      rotateToken,
      setAccessLevel,
      start,
      status,
      stop,
    ]
  );

  return (
    <McpRuntimeContext.Provider value={value}>
      {children}
    </McpRuntimeContext.Provider>
  );
}

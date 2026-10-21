import { useEffect, useState } from "react";

import {
  currentActivitySnapshot,
  subscribeActivity,
  type McpActivitySnapshot,
} from "./activity";

export function useMcpActivity(): McpActivitySnapshot {
  const [snapshot, setSnapshot] = useState<McpActivitySnapshot>(
    currentActivitySnapshot
  );

  useEffect(() => subscribeActivity(setSnapshot), []);

  return snapshot;
}

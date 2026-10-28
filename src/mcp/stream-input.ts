import { z } from "zod";

import { AppError } from "@/application/errors";

export const MCP_STREAM_FIELD = "input_stream";
export const MCP_MAX_STREAM_CHARS = 500_000;
export const MCP_MAX_STREAM_CHUNK_CHARS = 100_000;
export const MCP_MAX_STREAMS = 16;
export const MCP_STREAM_TTL_MS = 5 * 60 * 1_000;

export const STREAMABLE_FIELDS = new Set([
  "text",
  "body",
  "preface",
  "plot_summary",
  "synopsis",
  "stashed_text",
]);

const envelopeSchema = z
  .object({
    stream_id: z.string().min(8).max(120),
    field: z.string().min(1).max(64),
    chunk_index: z.number().int().nonnegative(),
    chunk_total: z.number().int().positive(),
    text: z.string().max(MCP_MAX_STREAM_CHUNK_CHARS),
    final: z.boolean(),
  })
  .strict();

export type McpInputStreamEnvelope = z.infer<typeof envelopeSchema>;

interface InputStream {
  field: string;
  chunkTotal: number;
  chunks: Map<number, string>;
  chars: number;
  createdAt: number;
}

const streams = new Map<string, InputStream>();

export function extractStreamInput(argumentsValue: Record<string, unknown>): {
  envelope: McpInputStreamEnvelope | null;
  argumentsValue: Record<string, unknown>;
} {
  const hasEnvelope = Object.prototype.hasOwnProperty.call(
    argumentsValue,
    MCP_STREAM_FIELD
  );
  if (!hasEnvelope) {
    return { envelope: null, argumentsValue };
  }

  const { [MCP_STREAM_FIELD]: envelope, ...rest } = argumentsValue;
  const parsed = envelopeSchema.safeParse(envelope);
  if (!parsed.success) {
    throw new AppError(
      "invalid_argument",
      "input_stream is not a valid streaming envelope.",
      parsed.error.flatten()
    );
  }
  return { envelope: parsed.data, argumentsValue: rest };
}

export function appendStreamInput(
  envelope: McpInputStreamEnvelope,
  allowedFields: ReadonlySet<string> = STREAMABLE_FIELDS
): number {
  if (!allowedFields.has(envelope.field)) {
    throw new AppError(
      "invalid_argument",
      `Streaming is not supported for field ${envelope.field}.`
    );
  }
  if (envelope.chunk_index >= envelope.chunk_total) {
    throw new AppError(
      "invalid_argument",
      "input_stream chunk_index must be less than chunk_total."
    );
  }

  pruneStreams();
  let stream = streams.get(envelope.stream_id);
  if (!stream) {
    if (envelope.chunk_index !== 0 || streams.size >= MCP_MAX_STREAMS) {
      throw new AppError(
        "invalid_argument",
        streams.size >= MCP_MAX_STREAMS
          ? "Too many input streams are active."
          : "input_stream must start at chunk_index 0."
      );
    }
    stream = {
      field: envelope.field,
      chunkTotal: envelope.chunk_total,
      chunks: new Map(),
      chars: 0,
      createdAt: Date.now(),
    };
    streams.set(envelope.stream_id, stream);
  }

  if (stream.field !== envelope.field) {
    throw new AppError(
      "invalid_argument",
      "input_stream field does not match the existing stream."
    );
  }
  if (stream.chunkTotal !== envelope.chunk_total) {
    throw new AppError(
      "invalid_argument",
      "input_stream chunk_total does not match the existing stream."
    );
  }
  if (stream.chunks.has(envelope.chunk_index)) {
    throw new AppError(
      "invalid_argument",
      "input_stream chunk was already received."
    );
  }
  if (envelope.chunk_index !== stream.chunks.size) {
    throw new AppError(
      "invalid_argument",
      `input_stream expected chunk_index ${stream.chunks.size}.`
    );
  }

  stream.createdAt = Date.now();
  stream.chars += envelope.text.length;
  if (stream.chars > MCP_MAX_STREAM_CHARS) {
    streams.delete(envelope.stream_id);
    throw new AppError(
      "invalid_argument",
      `input_stream exceeds ${MCP_MAX_STREAM_CHARS} characters.`
    );
  }
  stream.chunks.set(envelope.chunk_index, envelope.text);
  return stream.chunks.size;
}

export function streamInputSnapshot(streamId: string): {
  field: string;
  text: string;
  chars: number;
  receivedChunks: number;
  chunkTotal: number;
} | null {
  pruneStreams();
  const stream = streams.get(streamId);
  if (!stream) return null;
  return {
    field: stream.field,
    text: [...stream.chunks.values()].join(""),
    chars: stream.chars,
    receivedChunks: stream.chunks.size,
    chunkTotal: stream.chunkTotal,
  };
}

export function finishStreamInput(
  envelope: McpInputStreamEnvelope,
  allowedFields: ReadonlySet<string> = STREAMABLE_FIELDS
): string {
  if (!allowedFields.has(envelope.field)) {
    throw new AppError(
      "invalid_argument",
      `Streaming is not supported for field ${envelope.field}.`
    );
  }
  if (envelope.chunk_total === 1) {
    if (envelope.chunk_index !== 0) {
      throw new AppError(
        "invalid_argument",
        "The final input_stream chunk_index is invalid."
      );
    }
    if (envelope.text.length > MCP_MAX_STREAM_CHARS) {
      throw new AppError(
        "invalid_argument",
        `input_stream exceeds ${MCP_MAX_STREAM_CHARS} characters.`
      );
    }
    return envelope.text;
  }

  pruneStreams();
  const stream = streams.get(envelope.stream_id);
  if (!stream) {
    throw new AppError(
      "invalid_argument",
      "The input stream expired or was not started."
    );
  }
  if (stream.field !== envelope.field) {
    throw new AppError(
      "invalid_argument",
      "input_stream field does not match the existing stream."
    );
  }
  if (stream.chunkTotal !== envelope.chunk_total) {
    throw new AppError(
      "invalid_argument",
      "input_stream chunk_total does not match the existing stream."
    );
  }
  if (envelope.chunk_index !== stream.chunkTotal - 1) {
    throw new AppError(
      "invalid_argument",
      "The final input_stream chunk_index is invalid."
    );
  }
  if (stream.chunks.size !== envelope.chunk_total - 1) {
    throw new AppError(
      "invalid_argument",
      `input_stream expected chunk_index ${stream.chunks.size}.`
    );
  }
  if (stream.chars + envelope.text.length > MCP_MAX_STREAM_CHARS) {
    streams.delete(envelope.stream_id);
    throw new AppError(
      "invalid_argument",
      `input_stream exceeds ${MCP_MAX_STREAM_CHARS} characters.`
    );
  }

  streams.delete(envelope.stream_id);
  return [...stream.chunks.values(), envelope.text].join("");
}

export function streamSchemaForField(
  field: string
): Record<string, unknown> | null {
  if (!STREAMABLE_FIELDS.has(field)) return null;
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "stream_id",
      "field",
      "chunk_index",
      "chunk_total",
      "text",
      "final",
    ],
    properties: {
      stream_id: {
        type: "string",
        minLength: 8,
        maxLength: 120,
        description:
          "Client-generated stream ID reused by every chunk of one input.",
      },
      field: {
        type: "string",
        enum: [...STREAMABLE_FIELDS],
        description: "The target text field to assemble.",
      },
      chunk_index: {
        type: "integer",
        minimum: 0,
        description: "Zero-based contiguous chunk index.",
      },
      chunk_total: {
        type: "integer",
        minimum: 1,
        description: "Total number of chunks declared by the client.",
      },
      text: {
        type: "string",
        maxLength: MCP_MAX_STREAM_CHUNK_CHARS,
        description: "One chunk of UTF-8 text.",
      },
      final: {
        type: "boolean",
        description:
          "Set true on the last chunk; the tool executes after assembly.",
      },
    },
    description:
      "Optional streamed text input. Omit the target field until the final chunk is assembled.",
  };
}

function pruneStreams(): void {
  const now = Date.now();
  for (const [id, stream] of streams) {
    if (now - stream.createdAt >= MCP_STREAM_TTL_MS) streams.delete(id);
  }
}

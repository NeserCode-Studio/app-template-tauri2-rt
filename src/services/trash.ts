/**
 * 回收站：删除的作品 / 卷 / 章先落到工作区内的 `.trash/`，可恢复。
 *
 ## 为什么是「移动 + 清单」而不是真删除
 *
 写作软件的删除几乎都是误删，而「删了能找回来」是用户敢不敢放手写的心理前提。
 把文件移进 `.trash/` 而不是直接 `remove`，原因有三：
 1. **保留原始相对路径**才能精确还原。清单里记原路径，恢复时无需猜测。
 2. **同一 id 可能被重建**。若直接删掉 works/<id>，用户新建作品后目录名
    冲突会导致恢复覆盖新数据。落到 `.trash/<itemId>/` 天然隔离。
 3. **不占用工作区外的空间**，用户拷走整个工作区时回收站跟着走，
    换台机器也能恢复。
 *
 彻底删除是显式动作（二次确认），不做自动清理——自动清理等于替用户决定
 「多久之后就不算误删了」，而这个期限用户从没同意过。
 */

import { createFs, joinRel } from "./fs";
import { trashItemFile, workMetaFile, workspaceFile, TRASH_DIR } from "./paths";
import { z } from "zod";
import { createLogger } from "@/lib/logger";

const log = createLogger("TrashService");

/** 被删项的类型。 */
export const TRASH_KINDS = ["workspace", "work", "chapter", "volume"] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];

/** 单条回收记录。 */
export const trashItemSchema = z.object({
  /** 回收项 id（与原始 id 不同，避免与新建项冲突）。 */
  itemId: z.string().uuid(),
  kind: z.enum(TRASH_KINDS),
  /** 原始 id：作品 id / 章 id / 卷 id。 */
  originId: z.string().uuid(),
  /** 原始相对路径，chapter 用 json 文件路径、work 用目录。 */
  originPath: z.string(),
  /** 展示用标题。 */
  title: z.string(),
  /** 同级排序信息，恢复时用。 */
  parentId: z.string().uuid().nullable().default(null),
  order: z.number().int().default(0),
  deletedAt: z.number().int(),
  /**
   * 被一并删掉的子节点（卷 → 其下所有章）。
   *
   * 卷的删除是级联的：章文件一并进回收站，但结构树里那些章节点也会消失。
   * 只恢复卷节点而不恢复章节点，正文就变成孤儿文件，恢复等于半吊子。
   * 所以把子树节点原样记在这里，恢复时整棵挂回去。
   */
  subtree: z
    .array(
      z.object({
        id: z.string().uuid(),
        type: z.string(),
        title: z.string(),
        parentId: z.string().uuid().nullable(),
        order: z.number().int(),
        status: z.string().optional(),
        synopsis: z.string().optional(),
        createdAt: z.number().int(),
        updatedAt: z.number().int(),
      })
    )
    .default([]),
});

export type TrashItem = z.infer<typeof trashItemSchema>;

/** 清单：仅存 id 列表，详情在各自文件里，便于单条增删不重写全量。 */
const trashIndexSchema = z.object({
  items: z.array(z.string().uuid()).default([]),
});

/** 读取清单；不存在返回空。 */
async function readIndex(root: string): Promise<string[]> {
  const fs2 = createFs(root);
  const file = joinRel(TRASH_DIR, "index.json");
  if (!(await fs2.exists(file))) return [];
  try {
    return trashIndexSchema.parse(JSON.parse(await fs2.readText(file))).items;
  } catch (err) {
    log.error("trash index parse failed", err);
    return [];
  }
}

/** 写回清单。 */
async function writeIndex(root: string, items: string[]): Promise<void> {
  const fs2 = createFs(root);
  await fs2.writeText(
    joinRel(TRASH_DIR, "index.json"),
    JSON.stringify(trashIndexSchema.parse({ items }), null, 2)
  );
}

/**
 * 移入回收站。
 *
 * 章被删时 json 与 txt 两份都要带走，只删其一会留下孤儿 txt。
 * 卷本身没有文件（只在结构树里），因此记录节点信息即可。
 */
export async function moveToTrash(
  root: string,
  input: {
    kind: TrashKind;
    originId: string;
    /** 章：json 与 txt 的相对路径；作品：目录；卷：空。 */
    paths: string[];
    title: string;
    parentId?: string | null;
    order?: number;
    /** 卷删除时记下整棵子树，供恢复时挂回结构树。 */
    subtree?: TrashItem["subtree"];
  }
): Promise<TrashItem> {
  const fs2 = createFs(root);
  const item: TrashItem = trashItemSchema.parse({
    itemId: crypto.randomUUID(),
    kind: input.kind,
    originId: input.originId,
    originPath: input.paths[0] ?? "",
    title: input.title,
    parentId: input.parentId ?? null,
    order: input.order ?? 0,
    subtree: input.subtree ?? [],
    deletedAt: Date.now(),
  });

  await fs2.createDir(TRASH_DIR);
  const moved: { rel: string; dest: string }[] = [];
  for (const [i, p] of input.paths.entries()) {
    if (!(await fs2.exists(p))) continue;
    /*
     * 多文件（章的 json + txt）用序号后缀区分，避免同名互相覆盖。
     * 单文件沿用原扩展名，便于人工查看回收站内容。
     */
    const dot = p.lastIndexOf(".");
    const dest =
      input.paths.length > 1
        ? `${item.itemId}.${i}`
        : `${item.itemId}${dot > 0 ? p.slice(dot) : ""}`;
    await fs2.rename(p, joinRel(TRASH_DIR, dest));
    moved.push({ rel: p, dest });
  }

  await fs2.writeText(trashItemFile(item.itemId), JSON.stringify({ ...item, moved }, null, 2));
  await writeIndex(root, [...(await readIndex(root)), item.itemId]);
  log.info("moved to trash", { kind: input.kind, title: input.title });
  return item;
}

/**
 * 把整个工作区移入回收站。
 *
 * 回收站本身就在工作区里（`.trash/`），所以不能直接搬走根目录——
 * 那会把回收站连同自己一起搬走，恢复路径也就不存在了。
 * 做法是逐项搬：工作区根下的每个条目（作品、素材库、清单文件…）
 * 各自移进 `.trash/<itemId>.<序号>`，并把这份映射记进回收记录，
 * 恢复时按映射逐项搬回原位。等于把根目录"摊平"进回收站。
 */
export async function moveWorkspaceToTrash(root: string, title: string): Promise<TrashItem> {
  const fs2 = createFs(root);
  const item = trashItemSchema.parse({
    itemId: crypto.randomUUID(),
    kind: "workspace",
    originId: crypto.randomUUID(),
    originPath: "",
    title,
    parentId: null,
    order: 0,
    subtree: [],
    deletedAt: Date.now(),
  });

  await fs2.createDir(TRASH_DIR);
  const moved: { rel: string; dest: string }[] = [];
  /* 回收站自身不搬，否则它会在自己内部被再次搬运。 */
  for (const name of await fs2.readDir("")) {
    if (name === TRASH_DIR) continue;
    const rel = joinRel(name);
    const dest = `${item.itemId}.${moved.length}`;
    await fs2.rename(rel, joinRel(TRASH_DIR, dest));
    moved.push({ rel, dest });
  }

  await fs2.writeText(trashItemFile(item.itemId), JSON.stringify({ ...item, moved }, null, 2));
  /*
   * index.json 在 .trash/ 里，而回收站自身被显式跳过、仍留在原处，
   * 所以这里可以直接写。但清单（novels-yes.json）刚被搬走了——
   * 记下它原在哪，恢复时才能搬回原位。
   */
  await writeIndex(root, [...(await readIndex(root)), item.itemId]);
  log.info("workspace moved to trash", { root, entries: moved.length });
  return item;
}

/** 列出回收站条目（按删除时间倒序）。 */
export async function listTrash(root: string): Promise<TrashItem[]> {
  const fs2 = createFs(root);
  const out: TrashItem[] = [];
  for (const itemId of await readIndex(root)) {
    const file = trashItemFile(itemId);
    if (!(await fs2.exists(file))) continue;
    try {
      out.push(trashItemSchema.parse(JSON.parse(await fs2.readText(file))));
    } catch (err) {
      log.warn("trash item unreadable, skipped", itemId, err);
    }
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

/**
 * 恢复到原位置。原位置已被占用时返回 false，不覆盖。
 *
 * 章被删时结构树节点也被摘掉了，因此**只搬文件不够**——恢复后
 * 作品库里看不到它，结构树里也没有入口，等于没恢复。这里把节点信息
 * 记在回收记录里（title / parentId / order），恢复时补回结构树。
 * 所属作品可能也被删了，此时 parentId 指向的卷已不存在，
 * 故校验父节点存在才挂上去，否则降级为根层章。
 */
export async function restoreFromTrash(root: string, itemId: string): Promise<boolean> {
  const fs2 = createFs(root);
  const file = trashItemFile(itemId);
  if (!(await fs2.exists(file))) return false;
  const raw = JSON.parse(await fs2.readText(file)) as TrashItem & {
    moved?: { rel: string; dest: string }[];
  };

  /* 原位置已有同名文件：不覆盖，交给用户手动处理。 */
  for (const m of raw.moved ?? []) {
    if (await fs2.exists(m.rel)) {
      log.warn("restore skipped: target exists", m.rel);
      return false;
    }
  }
  for (const m of raw.moved ?? []) {
    const src = joinRel(TRASH_DIR, m.dest);
    if (!(await fs2.exists(src))) continue;
    /* 目标父目录可能已被删（如整部作品被删后目录没了）。 */
    const slash = m.rel.lastIndexOf("/");
    if (slash > 0) await fs2.createDir(m.rel.slice(0, slash));
    await fs2.rename(src, m.rel);
  }
  await fs2.remove(file);
  await reattachNode(root, raw);
  await reattachWork(root, raw);
  await writeIndex(
    root,
    (await readIndex(root)).filter((id) => id !== itemId)
  );
  log.info("restored from trash", { itemId });
  return true;
}

/**
 * 把恢复的作品重新登记进工作区清单。
 *
 * 删除作品时 `deleteWork` 会把它从 novels-yes.json 的 order 里摘掉，
 * 目录搬回磁盘只是搬回了文件——清单不认它，作品库照样当这部作品不存在
 * （只有下次冷启动时靠"扫 works/ 目录"的兜底才偶然露出来）。
 * 所以恢复必须同时把 id 塞回 order，否则"恢复"只是把文件放回原处。
 *
 * 这里直接读写 novels-yes.json 而不调 services/workspace：workspace 反过来
 * 依赖 trash（删除要走回收站），再从 trash 引回去就是一个循环依赖。
 */
async function reattachWork(root: string, item: TrashItem): Promise<void> {
  if (item.kind !== "work") return;
  const fs2 = createFs(root);
  const file = workspaceFile();
  if (!(await fs2.exists(file))) return;
  try {
    const raw = JSON.parse(await fs2.readText(file)) as {
      order?: string[];
      archived?: string[];
    };
    const order = raw.order ?? [];
    if (order.includes(item.originId)) return;
    raw.order = [...order, item.originId];
    await fs2.writeText(file, JSON.stringify(raw, null, 2));
    /*
     * 归档标记也要抹平：删除一部已归档作品时，清单里的 archived 会被摘掉，
     * 但 work.json 的 archived 仍是 true。恢复出来若带着这个标记，卡片会
     * 直接渲染成归档态、"继续写作"点不动——比没恢复更让人困惑。
     * （deleteWork 也从清单里摘了 archived，所以恢复出来应当是常规作品。）
     */
    await clearWorkArchived(root, item.originId);
    log.info("work re-registered in manifest", { id: item.originId });
  } catch (err) {
    /* 清单坏了就跳过：文件已经搬回去了，冷启动的目录兜底还能救回来。 */
    log.error("work re-register failed", err);
  }
}

/** 抹掉作品自身的归档标记，使恢复出来的作品是常规态。 */
async function clearWorkArchived(root: string, workId: string): Promise<void> {
  try {
    const fs2 = createFs(root);
    const meta = workMetaFile(workId);
    if (!(await fs2.exists(meta))) return;
    const raw = JSON.parse(await fs2.readText(meta)) as { archived?: boolean };
    if (raw.archived !== true) return;
    await fs2.writeText(meta, JSON.stringify({ ...raw, archived: false }, null, 2));
  } catch (err) {
    log.warn("work archived flag not cleared on restore", { workId, err });
  }
}

/** 把章 / 卷重新登记回结构树。 */
async function reattachNode(root: string, item: TrashItem): Promise<void> {
  /* 作品与工作区不需要挂回结构树：前者整目录已搬回，后者连清单一起。 */
  if (item.kind === "work" || item.kind === "workspace") return;
  const fs2 = createFs(root);
  const file = joinRel("works", item.originId, "outline.json");
  if (!(await fs2.exists(file))) return;

  const raw = JSON.parse(await fs2.readText(file)) as { nodes: unknown[] };
  if (!Array.isArray(raw.nodes)) return;
  /* 已经回到树里（用户手工改过）：不重复添加。 */
  if (raw.nodes.some((n) => (n as { id?: string }).id === item.originId)) return;

  /*
   * parentId 指向的卷可能连同作品一起被删了。先确认父节点还在，
   * 不在就挂到根层——位置不理想，但比恢复到一半卡住好。
   */
  const parentGone =
    item.parentId !== null &&
    !raw.nodes.some((n) => (n as { id?: string }).id === item.parentId);
  const now = Date.now();
  const node = {
    id: item.originId,
    type: item.kind,
    title: item.title,
    parentId: parentGone ? null : item.parentId,
    order: item.order,
    status: "draft",
    synopsis: "",
    collapsed: false,
    createdAt: now,
    updatedAt: now,
  };
  /* 卷：连同记录下来的子树一起挂回，章节点才不会变成孤儿文件。 */
  raw.nodes.push(node, ...item.subtree);
  await fs2.writeText(file, JSON.stringify(raw, null, 2));
  log.info("outline node restored", { id: item.originId, parentGone });
}

/** 彻底删除（不可恢复）。 */
export async function purgeFromTrash(root: string, itemId: string): Promise<void> {
  const fs2 = createFs(root);
  const file = trashItemFile(itemId);
  if (await fs2.exists(file)) {
    try {
      const raw = JSON.parse(await fs2.readText(file)) as { moved?: { dest: string }[] };
      for (const m of raw.moved ?? []) {
        const p = joinRel(TRASH_DIR, m.dest);
        if (await fs2.exists(p)) await fs2.remove(p);
      }
    } catch {
      /* 清单坏了也照样清数据文件，避免垃圾留在磁盘上。 */
    }
    await fs2.remove(file);
  }
  await writeIndex(
    root,
    (await readIndex(root)).filter((id) => id !== itemId)
  );
}

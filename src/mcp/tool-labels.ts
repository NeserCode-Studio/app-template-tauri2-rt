import { getAppCommand } from "@/application/registry";

const ZH_TOOL_LABELS: Record<string, string> = {
  novels_workspace_get: "读取工作区状态",
  novels_workspace_set_alias: "修改工作区别名",
  novels_workspace_recent_list: "查看最近工作区",
  novels_workspace_recent_remove: "移除最近工作区记录",
  novels_workspace_reveal: "打开工作区文件夹",
  novels_workspace_scan: "扫描并修复工作区",
  novels_workspace_scan_preview: "预览工作区扫描",
  novels_workspace_create: "新建工作区",
  novels_workspace_open: "打开其他工作区",
  novels_workspace_close: "关闭工作区",
  novels_workspace_delete: "永久删除工作区",
  novels_workspace_migrate: "迁移工作区",
  novels_work_list: "查看作品列表",
  novels_work_get: "读取作品信息",
  novels_work_select: "切换当前作品",
  novels_work_create: "新建作品",
  novels_work_update: "更新作品信息",
  novels_work_archive: "归档作品",
  novels_work_unarchive: "取消归档作品",
  novels_work_delete: "删除作品",
  novels_work_reparagraph: "重排作品段落",
  novels_outline_get: "读取作品目录",
  novels_volume_create: "新建卷",
  novels_chapter_create: "新建章节",
  novels_scene_create: "新建场景",
  novels_node_update: "更新目录节点",
  novels_node_move: "移动目录节点",
  novels_node_delete: "删除目录节点",
  novels_outline_reconcile: "校准作品目录",
  novels_chapter_list: "查看章节列表",
  novels_chapter_get: "读取章节内容",
  novels_chapter_save: "保存章节",
  novels_chapter_append: "追加章节内容",
  novels_chapter_replace: "替换章节正文",
  novels_chapter_split_card: "拆分章节段落",
  novels_chapter_merge_cards: "合并章节段落",
  novels_chapter_history_list: "查看章节历史",
  novels_chapter_history_read: "读取章节历史版本",
  novels_chapter_history_restore: "恢复章节历史版本",
  novels_chapter_history_delete: "删除章节历史版本",
  novels_codex_type_create: "新建素材类型",
  novels_codex_type_list: "查看素材类型",
  novels_codex_type_update: "更新素材类型",
  novels_codex_type_delete: "删除素材类型",
  novels_codex_entry_list: "查看素材条目",
  novels_codex_entry_get: "读取素材条目",
  novels_codex_entry_create: "新建素材条目",
  novels_codex_entry_update: "更新素材条目",
  novels_codex_entry_delete: "删除素材条目",
  novels_codex_relation_list: "查看素材关系",
  novels_codex_relation_add: "添加素材关系",
  novels_codex_relation_delete: "删除素材关系",
  novels_codex_mentions_get: "查看素材提及",
  novels_codex_mentions_scan: "扫描素材提及",
  novels_draft_list: "查看草稿",
  novels_draft_get: "读取草稿",
  novels_draft_save: "保存草稿",
  novels_draft_delete: "删除草稿",
  novels_import_preview: "预览小说导入",
  novels_import_commit: "提交小说导入",
  novels_export_text: "导出作品文本",
  novels_export_file: "导出作品文件",
  novels_stats_get: "读取写作统计",
  novels_stats_update: "更新统计设置",
  novels_stats_recalculate: "重新计算写作统计",
  novels_search: "搜索工作区",
  novels_trash_list: "查看回收站",
  novels_trash_restore: "恢复回收站项目",
  novels_trash_purge: "彻底删除回收站项目",
  novels_trash_purge_all: "清空回收站",
  novels_preferences_get: "读取写作偏好",
  novels_preferences_update: "更新写作偏好",
  novels_app_settings_get: "读取应用设置",
  novels_app_settings_update: "更新应用设置",
  novels_ui_open: "打开应用对话框",
  novels_navigate: "跳转应用页面",
  novels_open_chapter: "打开章节",
};

export function mcpToolLabel(toolName: string, language: string): string {
  if (toolName.startsWith("resource:")) {
    return language.startsWith("zh")
      ? "读取工作区资源"
      : "Read workspace resource";
  }
  if (toolName.startsWith("prompt:")) {
    return language.startsWith("zh") ? "展开写作提示" : "Expand writing prompt";
  }
  if (language.startsWith("zh")) {
    return (
      ZH_TOOL_LABELS[toolName] ??
      getAppCommand(toolName)?.title ??
      toolName.replace(/_/g, " ")
    );
  }
  return getAppCommand(toolName)?.title ?? toolName.replace(/_/g, " ");
}

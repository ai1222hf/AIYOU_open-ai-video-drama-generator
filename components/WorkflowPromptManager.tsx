import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  FileText,
  Layers,
  Redo2,
  RefreshCw,
  Save,
  Search,
  Undo2,
  Upload,
  Variable,
  X
} from 'lucide-react';
import { AppNode, Connection, NodeType } from '../types';
import { getNodeNameCN } from '../utils/nodeHelpers';

interface WorkflowPromptManagerProps {
  isOpen: boolean;
  nodes: AppNode[];
  connections: Connection[];
  onClose: () => void;
  onApplyPrompt: (nodeId: string, prompt: string) => Promise<void> | void;
  onApplyBatch: (updates: Array<{ nodeId: string; prompt: string }>) => Promise<void> | void;
  onPersist?: () => Promise<void> | void;
}

type ApplyState = 'idle' | 'saving' | 'success' | 'error';

interface PromptVersion {
  id: string;
  prompt: string;
  createdAt: string;
}

interface NodeDraft {
  nodeId: string;
  prompt: string;
  dirty: boolean;
  applyState: ApplyState;
  error?: string;
  versions: PromptVersion[];
}

const PROMPTABLE_NODE_TYPES = new Set<NodeType>([
  NodeType.PROMPT_INPUT,
  NodeType.IMAGE_GENERATOR,
  NodeType.VIDEO_GENERATOR,
  NodeType.AUDIO_GENERATOR,
  NodeType.SCRIPT_PLANNER,
  NodeType.SCRIPT_EPISODE,
  NodeType.STORYBOARD_GENERATOR,
  NodeType.STORYBOARD_IMAGE,
  NodeType.STORYBOARD_SPLITTER,
  NodeType.SORA_VIDEO_GENERATOR,
  NodeType.STORYBOARD_VIDEO_GENERATOR,
  NodeType.DRAMA_ANALYZER,
  NodeType.DRAMA_REFINED,
  NodeType.STYLE_PRESET,
  NodeType.CHARACTER_NODE,
]);

const LOCAL_KEY = 'workflow-prompt-manager-drafts-v1';
const MAX_VERSIONS = 10;

const validatePrompt = (prompt: string): string | null => {
  if (!prompt.trim()) return '提示词不能为空。';
  const open = (prompt.match(/\{/g) || []).length;
  const close = (prompt.match(/\}/g) || []).length;
  if (open !== close) return '变量格式错误：请检查大括号是否成对。';
  return null;
};

const getNodeDepthMap = (nodes: AppNode[], connections: Connection[]) => {
  const ids = new Set(nodes.map((n) => n.id));
  const inbound = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  nodes.forEach((n) => {
    inbound.set(n.id, 0);
    adjacency.set(n.id, []);
  });

  connections.forEach((c) => {
    if (!ids.has(c.from) || !ids.has(c.to)) return;
    adjacency.get(c.from)?.push(c.to);
    inbound.set(c.to, (inbound.get(c.to) || 0) + 1);
  });

  const queue: string[] = [];
  const depthMap = new Map<string, number>();
  inbound.forEach((count, id) => {
    if (count === 0) {
      queue.push(id);
      depthMap.set(id, 0);
    }
  });

  while (queue.length) {
    const current = queue.shift()!;
    const depth = depthMap.get(current) || 0;
    (adjacency.get(current) || []).forEach((to) => {
      depthMap.set(to, Math.max(depthMap.get(to) ?? 0, depth + 1));
      inbound.set(to, (inbound.get(to) || 0) - 1);
      if ((inbound.get(to) || 0) <= 0) queue.push(to);
    });
  }

  nodes.forEach((n) => {
    if (!depthMap.has(n.id)) depthMap.set(n.id, 0);
  });

  return depthMap;
};

export const WorkflowPromptManager: React.FC<WorkflowPromptManagerProps> = ({
  isOpen,
  nodes,
  connections,
  onClose,
  onApplyPrompt,
  onApplyBatch,
  onPersist,
}) => {
  const promptNodes = useMemo(
    () => nodes.filter((node) => PROMPTABLE_NODE_TYPES.has(node.type)),
    [nodes]
  );

  const depthMap = useMemo(() => getNodeDepthMap(promptNodes, connections), [promptNodes, connections]);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [onlyDirty, setOnlyDirty] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, NodeDraft>>({});
  const [undoStack, setUndoStack] = useState<Record<string, string[]>>({});
  const [redoStack, setRedoStack] = useState<Record<string, string[]>>({});
  const [globalMessage, setGlobalMessage] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const localRaw = localStorage.getItem(LOCAL_KEY);
    const localMap: Record<string, NodeDraft> = localRaw ? JSON.parse(localRaw) : {};
    const next: Record<string, NodeDraft> = {};

    promptNodes.forEach((n) => {
      const local = localMap[n.id];
      next[n.id] = {
        nodeId: n.id,
        prompt: local?.prompt ?? n.data.prompt ?? '',
        dirty: local?.dirty ?? false,
        applyState: 'idle',
        error: undefined,
        versions: local?.versions ?? [],
      };
    });

    setDrafts(next);
    setUndoStack({});
    setRedoStack({});
    setSelectedNodeId((current) => current || promptNodes[0]?.id || null);
    setGlobalMessage('');
  }, [isOpen, promptNodes]);

  useEffect(() => {
    if (!isOpen) return;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(drafts));
  }, [drafts, isOpen]);

  useEffect(() => {
    if (!isOpen || !onPersist) return;
    const dirtyCount = Object.values(drafts).filter((item) => item.dirty).length;
    if (!dirtyCount) return;

    const timer = setTimeout(async () => {
      try {
        setIsSyncing(true);
        await onPersist();
        setGlobalMessage(`已自动同步 ${dirtyCount} 个节点到后端。`);
      } catch (error: any) {
        setGlobalMessage(`自动同步失败：${error?.message || '请稍后重试'}`);
      } finally {
        setIsSyncing(false);
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, [drafts, isOpen, onPersist]);

  const nodeTypes = useMemo(() => {
    return ['ALL', ...Array.from(new Set(promptNodes.map((n) => n.type)))];
  }, [promptNodes]);

  const filteredNodes = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return promptNodes
      .filter((node) => {
        if (typeFilter !== 'ALL' && node.type !== typeFilter) return false;
        if (onlyDirty && !drafts[node.id]?.dirty) return false;
        if (!keyword) return true;
        return (
          node.title.toLowerCase().includes(keyword) ||
          getNodeNameCN(node.type).toLowerCase().includes(keyword) ||
          (drafts[node.id]?.prompt || '').toLowerCase().includes(keyword)
        );
      })
      .sort((a, b) => {
        const depthA = depthMap.get(a.id) || 0;
        const depthB = depthMap.get(b.id) || 0;
        if (depthA !== depthB) return depthA - depthB;
        return a.title.localeCompare(b.title);
      });
  }, [depthMap, drafts, onlyDirty, promptNodes, search, typeFilter]);

  const selectedDraft = selectedNodeId ? drafts[selectedNodeId] : null;

  const handleDraftChange = useCallback((nodeId: string, value: string) => {
    setDrafts((prev) => {
      const current = prev[nodeId];
      if (!current) return prev;
      return {
        ...prev,
        [nodeId]: {
          ...current,
          prompt: value,
          dirty: true,
          applyState: 'idle',
          error: undefined,
        },
      };
    });
  }, []);

  const withSnapshot = (nodeId: string, currentPrompt: string, updater: () => void) => {
    setUndoStack((prev) => ({ ...prev, [nodeId]: [...(prev[nodeId] || []), currentPrompt] }));
    setRedoStack((prev) => ({ ...prev, [nodeId]: [] }));
    updater();
  };

  const insertVariable = (variableName: string) => {
    if (!selectedDraft || !selectedNodeId) return;
    withSnapshot(selectedNodeId, selectedDraft.prompt, () => {
      handleDraftChange(selectedNodeId, `${selectedDraft.prompt} {{${variableName}}}`.trim());
    });
  };

  const applyFormat = (prefix: string, suffix = prefix) => {
    if (!selectedDraft || !selectedNodeId) return;
    withSnapshot(selectedNodeId, selectedDraft.prompt, () => {
      handleDraftChange(selectedNodeId, `${selectedDraft.prompt}${prefix}示例文本${suffix}`);
    });
  };

  const handleUndo = () => {
    if (!selectedDraft || !selectedNodeId) return;
    const stack = undoStack[selectedNodeId] || [];
    if (!stack.length) return;
    const previous = stack[stack.length - 1];
    setUndoStack((prev) => ({ ...prev, [selectedNodeId]: stack.slice(0, -1) }));
    setRedoStack((prev) => ({ ...prev, [selectedNodeId]: [...(prev[selectedNodeId] || []), selectedDraft.prompt] }));
    handleDraftChange(selectedNodeId, previous);
  };

  const handleRedo = () => {
    if (!selectedDraft || !selectedNodeId) return;
    const stack = redoStack[selectedNodeId] || [];
    if (!stack.length) return;
    const next = stack[stack.length - 1];
    setRedoStack((prev) => ({ ...prev, [selectedNodeId]: stack.slice(0, -1) }));
    setUndoStack((prev) => ({ ...prev, [selectedNodeId]: [...(prev[selectedNodeId] || []), selectedDraft.prompt] }));
    handleDraftChange(selectedNodeId, next);
  };

  const saveVersion = (nodeId: string) => {
    setDrafts((prev) => {
      const current = prev[nodeId];
      if (!current) return prev;
      const version: PromptVersion = {
        id: `${nodeId}-${Date.now()}`,
        prompt: current.prompt,
        createdAt: new Date().toLocaleString('zh-CN'),
      };
      return {
        ...prev,
        [nodeId]: {
          ...current,
          versions: [version, ...current.versions].slice(0, MAX_VERSIONS),
        },
      };
    });
  };

  const restoreVersion = (nodeId: string, prompt: string) => {
    const current = drafts[nodeId];
    if (!current) return;
    withSnapshot(nodeId, current.prompt, () => {
      handleDraftChange(nodeId, prompt);
    });
  };

  const applySingle = async (nodeId: string) => {
    const draft = drafts[nodeId];
    if (!draft) return;
    const error = validatePrompt(draft.prompt);
    if (error) {
      setDrafts((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], applyState: 'error', error } }));
      return;
    }

    try {
      setDrafts((prev) => ({ ...prev, [nodeId]: { ...prev[nodeId], applyState: 'saving', error: undefined } }));
      await onApplyPrompt(nodeId, draft.prompt);
      setDrafts((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], applyState: 'success', dirty: false, error: undefined },
      }));
      saveVersion(nodeId);
    } catch (error: any) {
      setDrafts((prev) => ({
        ...prev,
        [nodeId]: { ...prev[nodeId], applyState: 'error', error: error?.message || '应用失败' },
      }));
    }
  };

  const applyDirtyBatch = async () => {
    const targets = Object.values(drafts).filter((item) => item.dirty);
    if (!targets.length) {
      setGlobalMessage('没有待应用的修改。');
      return;
    }

    const invalid = targets.find((item) => validatePrompt(item.prompt));
    if (invalid) {
      setGlobalMessage(`节点 ${invalid.nodeId} 提示词格式错误，请先修复。`);
      return;
    }

    try {
      setGlobalMessage('批量应用中...');
      await onApplyBatch(targets.map((item) => ({ nodeId: item.nodeId, prompt: item.prompt })));
      setDrafts((prev) => {
        const next = { ...prev };
        targets.forEach((item) => {
          next[item.nodeId] = { ...next[item.nodeId], dirty: false, applyState: 'success', error: undefined };
        });
        return next;
      });
      targets.forEach((item) => saveVersion(item.nodeId));
      setGlobalMessage(`已批量应用 ${targets.length} 个节点。`);
    } catch (error: any) {
      setGlobalMessage(`批量应用失败：${error?.message || '请稍后重试'}`);
    }
  };

  const exportDrafts = () => {
    const blob = new Blob([JSON.stringify(drafts, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompt-drafts-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importDrafts = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        setDrafts((prev) => {
          const next = { ...prev };
          Object.keys(next).forEach((key) => {
            if (parsed[key]?.prompt !== undefined) {
              next[key] = { ...next[key], prompt: parsed[key].prompt, dirty: true };
            }
          });
          return next;
        });
        setGlobalMessage('已导入提示词草稿。');
      } catch {
        setGlobalMessage('导入失败：文件格式不正确。');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="w-[min(1200px,96vw)] h-[min(86vh,860px)] mx-auto mt-[6vh] bg-[#111317] border border-white/10 rounded-2xl overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
          <Layers size={16} className="text-cyan-300" />
          <h2 className="text-sm font-semibold text-white">工作流节点提示词管理</h2>
          <div className="ml-auto flex items-center gap-2">
            {isSyncing && <span className="text-[11px] text-cyan-300 flex items-center gap-1"><RefreshCw size={12} className="animate-spin" />同步中</span>}
            <button className="px-2 py-1 text-xs bg-white/10 rounded hover:bg-white/20 text-slate-200" onClick={applyDirtyBatch}>一键应用全部修改</button>
            <button className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-300" onClick={onClose}><X size={14} /></button>
          </div>
        </div>

        <div className="px-4 py-2 border-b border-white/10 flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-2 px-2 py-1 bg-white/5 rounded border border-white/10">
            <Search size={13} className="text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索节点/提示词"
              className="bg-transparent outline-none text-slate-200 w-40"
            />
          </div>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="px-2 py-1 bg-white/5 border border-white/10 rounded text-slate-200">
            {nodeTypes.map((type) => <option key={type} value={type}>{type === 'ALL' ? '全部类型' : getNodeNameCN(type as NodeType)}</option>)}
          </select>
          <label className="flex items-center gap-1 text-slate-300">
            <input type="checkbox" checked={onlyDirty} onChange={(e) => setOnlyDirty(e.target.checked)} />
            仅看已修改
          </label>
          <button className="px-2 py-1 rounded bg-white/5 text-slate-200 hover:bg-white/10" onClick={exportDrafts}><Download size={12} className="inline mr-1" />导出</button>
          <label className="px-2 py-1 rounded bg-white/5 text-slate-200 hover:bg-white/10 cursor-pointer"><Upload size={12} className="inline mr-1" />导入<input type="file" accept="application/json" className="hidden" onChange={importDrafts} /></label>
          {globalMessage && <span className="text-[11px] text-slate-300">{globalMessage}</span>}
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[320px_1fr]">
          <div className="border-r border-white/10 overflow-y-auto custom-scrollbar p-2 space-y-2">
            {filteredNodes.map((node) => {
              const draft = drafts[node.id];
              const stateColor = draft?.applyState === 'error' ? 'text-red-300' : draft?.applyState === 'success' ? 'text-green-300' : 'text-slate-500';
              return (
                <button
                  key={node.id}
                  onClick={() => setSelectedNodeId(node.id)}
                  className={`w-full text-left rounded-lg border px-3 py-2 transition ${selectedNodeId === node.id ? 'border-cyan-400 bg-cyan-500/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-100 truncate">{node.title}</span>
                    <span className={`text-[10px] ${stateColor}`}>{draft?.dirty ? '已修改' : '已同步'}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 flex items-center gap-2">
                    <span>层级 L{depthMap.get(node.id) || 0}</span>
                    <span>·</span>
                    <span>{getNodeNameCN(node.type)}</span>
                  </div>
                  {draft?.error && <div className="mt-1 text-[11px] text-red-300 flex items-center gap-1"><AlertTriangle size={12} />{draft.error}</div>}
                </button>
              );
            })}
            {!filteredNodes.length && <div className="text-xs text-slate-400 p-3">未匹配到节点。</div>}
          </div>

          <div className="min-h-0 overflow-y-auto custom-scrollbar p-4">
            {!selectedDraft || !selectedNodeId ? (
              <div className="h-full flex items-center justify-center text-slate-500 text-sm">请选择一个节点开始编辑提示词。</div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={handleUndo} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-slate-200"><Undo2 size={12} className="inline mr-1" />撤销</button>
                  <button onClick={handleRedo} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-slate-200"><Redo2 size={12} className="inline mr-1" />重做</button>
                  <button onClick={() => applyFormat('**')} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-slate-200">B</button>
                  <button onClick={() => applyFormat('*')} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-slate-200">I</button>
                  <button onClick={() => insertVariable('character_name')} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-slate-200"><Variable size={12} className="inline mr-1" />插入变量</button>
                  <button onClick={() => navigator.clipboard.writeText(selectedDraft.prompt)} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-slate-200"><Copy size={12} className="inline mr-1" />复制</button>
                </div>

                <textarea
                  value={selectedDraft.prompt}
                  onChange={(e) => {
                    withSnapshot(selectedNodeId, selectedDraft.prompt, () => {
                      handleDraftChange(selectedNodeId, e.target.value);
                    });
                  }}
                  className="w-full h-[300px] md:h-[360px] bg-black/30 border border-white/10 rounded-xl p-3 text-sm text-slate-100 outline-none focus:border-cyan-400 resize-y"
                  placeholder="在这里编辑节点提示词，支持变量 {{variable}}"
                />

                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => saveVersion(selectedNodeId)} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-slate-200"><Clock3 size={12} className="inline mr-1" />保存版本</button>
                  <button onClick={() => applySingle(selectedNodeId)} className="px-3 py-1.5 text-xs rounded bg-cyan-500/20 border border-cyan-400/40 hover:bg-cyan-500/30 text-cyan-100"><Save size={12} className="inline mr-1" />应用到当前节点</button>
                  <span className="text-[11px] text-slate-400">状态：{selectedDraft.applyState === 'success' ? <span className="text-green-300 inline-flex items-center gap-1"><CheckCircle2 size={12} />应用成功</span> : selectedDraft.applyState === 'saving' ? '保存中...' : selectedDraft.applyState === 'error' ? <span className="text-red-300">应用失败</span> : '待保存'}</span>
                </div>

                <div className="border border-white/10 rounded-xl p-3 bg-white/5">
                  <div className="text-xs text-slate-300 mb-2 flex items-center gap-1"><FileText size={12} />版本历史（最近 {MAX_VERSIONS} 条）</div>
                  <div className="space-y-2 max-h-36 overflow-y-auto custom-scrollbar">
                    {selectedDraft.versions.length === 0 && <div className="text-[11px] text-slate-500">暂无版本记录</div>}
                    {selectedDraft.versions.map((version) => (
                      <button key={version.id} className="w-full text-left text-[11px] rounded border border-white/10 bg-black/20 px-2 py-1 hover:bg-white/10" onClick={() => restoreVersion(selectedNodeId, version.prompt)}>
                        <div className="text-slate-300">{version.createdAt}</div>
                        <div className="text-slate-500 truncate">{version.prompt}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

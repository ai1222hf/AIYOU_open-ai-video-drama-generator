import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Copy, History, Redo2, Search, Undo2, Wand2, X } from 'lucide-react';
import { AppNode, Connection } from '../types';

interface WorkflowPromptManagerProps {
  isOpen: boolean;
  nodes: AppNode[];
  connections: Connection[];
  onClose: () => void;
  onApplyNodePrompt: (nodeId: string, data: Partial<AppNode['data']>) => Promise<void> | void;
  onApplyBatchPrompt: (updates: Array<{ nodeId: string; data: Partial<AppNode['data']> }>) => Promise<void> | void;
  onSync?: () => Promise<void> | void;
}

type PromptFieldKey = 'prompt' | 'generatedPrompt' | 'stylePrompt' | 'negativePrompt' | 'customPrompt';

interface PromptFieldDef {
  key: PromptFieldKey;
  label: string;
  placeholder: string;
}

const PROMPT_FIELDS: PromptFieldDef[] = [
  { key: 'prompt', label: '主提示词', placeholder: '输入节点主提示词...' },
  { key: 'generatedPrompt', label: '生成提示词', placeholder: '输入 AI 生成提示词...' },
  { key: 'stylePrompt', label: '风格提示词', placeholder: '输入风格提示词...' },
  { key: 'negativePrompt', label: '负面提示词', placeholder: '输入负面提示词...' },
  { key: 'customPrompt', label: '自定义提示词', placeholder: '输入自定义提示词...' },
];

const VARIABLE_SNIPPETS = ['{{角色}}', '{{场景}}', '{{镜头}}', '{{风格}}', '{{时长}}', '{{情绪}}'];

const LOCAL_STORAGE_KEY = 'workflow_prompt_manager_drafts_v1';

const validatePrompt = (text: string): string | null => {
  const open = (text.match(/{{/g) || []).length;
  const close = (text.match(/}}/g) || []).length;
  if (open !== close) return '变量格式错误：请检查 {{ 和 }} 是否成对出现';
  if (text.length > 6000) return '提示词过长，建议控制在 6000 字以内以保证处理性能';
  return null;
};

export function WorkflowPromptManager({
  isOpen,
  nodes,
  connections,
  onClose,
  onApplyNodePrompt,
  onApplyBatchPrompt,
  onSync,
}: WorkflowPromptManagerProps) {
  const [search, setSearch] = useState('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<PromptFieldKey, string>>>>({});
  const [historyMap, setHistoryMap] = useState<Record<string, Array<{ at: number; fields: Partial<Record<PromptFieldKey, string>> }>>>({});
  const [historyCursor, setHistoryCursor] = useState<Record<string, number>>({});
  const [filterType, setFilterType] = useState<'all' | 'changed' | 'hasPrompt'>('all');
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [renderLimit, setRenderLimit] = useState(120);

  useEffect(() => {
    if (!isOpen) return;
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, Partial<Record<PromptFieldKey, string>>>;
        setDrafts(parsed);
      }
    } catch (e) {
      console.warn('[WorkflowPromptManager] parse local drafts failed', e);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(drafts));
      setStatus('草稿已实时保存');
    }, 350);
    return () => clearTimeout(timer);
  }, [drafts, isOpen]);

  const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

  const roots = useMemo(() => {
    const incoming = new Set(connections.map(c => c.to));
    return nodes.filter(n => !incoming.has(n.id));
  }, [connections, nodes]);

  const hierarchyDepth = useMemo(() => {
    const depth = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    connections.forEach(c => {
      if (!adjacency.has(c.from)) adjacency.set(c.from, []);
      adjacency.get(c.from)?.push(c.to);
    });

    const queue: Array<{ id: string; d: number }> = roots.map(r => ({ id: r.id, d: 0 }));
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      if (depth.has(current.id) && (depth.get(current.id) || 0) <= current.d) continue;
      depth.set(current.id, current.d);
      (adjacency.get(current.id) || []).forEach(child => queue.push({ id: child, d: current.d + 1 }));
    }
    nodes.forEach(n => {
      if (!depth.has(n.id)) depth.set(n.id, 0);
    });
    return depth;
  }, [connections, nodes, roots]);

  const flatNodes = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    const result = nodes.filter(node => {
      const promptText = [
        node.data.prompt,
        node.data.generatedPrompt,
        node.data.stylePrompt,
        node.data.negativePrompt,
        node.data.customPrompt,
      ].filter(Boolean).join(' ');

      const inKeyword = !keyword ||
        node.title.toLowerCase().includes(keyword) ||
        node.id.toLowerCase().includes(keyword) ||
        promptText.toLowerCase().includes(keyword);

      if (!inKeyword) return false;

      if (filterType === 'hasPrompt') return Boolean(promptText.trim());
      if (filterType === 'changed') {
        const nodeDraft = drafts[node.id] || {};
        return Object.keys(nodeDraft).some(key => {
          const typedKey = key as PromptFieldKey;
          return (nodeDraft[typedKey] ?? '') !== ((node.data[typedKey] as string) ?? '');
        });
      }
      return true;
    });

    return result.sort((a, b) => {
      const da = hierarchyDepth.get(a.id) ?? 0;
      const db = hierarchyDepth.get(b.id) ?? 0;
      if (da !== db) return da - db;
      return a.x - b.x;
    });
  }, [drafts, filterType, hierarchyDepth, nodes, search]);

  const visibleNodes = useMemo(() => flatNodes.slice(0, renderLimit), [flatNodes, renderLimit]);

  const getFieldValue = (node: AppNode, key: PromptFieldKey) => {
    const draft = drafts[node.id]?.[key];
    if (typeof draft === 'string') return draft;
    return (node.data[key] as string) || '';
  };

  const writeHistorySnapshot = (nodeId: string, fields: Partial<Record<PromptFieldKey, string>>) => {
    setHistoryMap(prev => {
      const prevList = prev[nodeId] || [];
      const cursor = historyCursor[nodeId] ?? (prevList.length - 1);
      const sliced = prevList.slice(0, cursor + 1);
      return {
        ...prev,
        [nodeId]: [...sliced, { at: Date.now(), fields }].slice(-30),
      };
    });
    setHistoryCursor(prev => {
      const next = (historyMap[nodeId]?.length ?? 0);
      return { ...prev, [nodeId]: next };
    });
  };

  const updateDraft = (node: AppNode, key: PromptFieldKey, value: string) => {
    const validation = validatePrompt(value);
    if (validation) {
      setError(validation);
    } else {
      setError('');
    }

    const nextFields = {
      ...(drafts[node.id] || {}),
      [key]: value,
    };
    setDrafts(prev => ({
      ...prev,
      [node.id]: nextFields,
    }));
    writeHistorySnapshot(node.id, nextFields);
  };

  const applySingle = async (node: AppNode) => {
    const draft = drafts[node.id];
    if (!draft) {
      setStatus('当前节点无待应用修改');
      return;
    }
    const hasError = Object.values(draft).some(v => validatePrompt(v || '') !== null);
    if (hasError) {
      setError('存在格式错误，修正后再应用');
      return;
    }
    await onApplyNodePrompt(node.id, draft);
    setStatus(`已应用到节点：${node.title}`);
    if (onSync) {
      setIsSyncing(true);
      await onSync();
      setIsSyncing(false);
      setStatus(`已应用并同步：${node.title}`);
    }
  };

  const applySelected = async () => {
    if (selectedNodeIds.length === 0) {
      setStatus('请先选择节点');
      return;
    }

    const updates = selectedNodeIds.map(id => ({ nodeId: id, data: drafts[id] || {} }))
      .filter(item => Object.keys(item.data).length > 0);

    if (updates.length === 0) {
      setStatus('选中节点无待应用修改');
      return;
    }

    const invalidNode = updates.find(item => Object.values(item.data).some(v => validatePrompt(v || '') !== null));
    if (invalidNode) {
      const target = nodeMap.get(invalidNode.nodeId);
      setError(`节点「${target?.title || invalidNode.nodeId}」存在格式错误，请修正后重试`);
      return;
    }

    await onApplyBatchPrompt(updates);
    setStatus(`已批量应用 ${updates.length} 个节点`);

    if (onSync) {
      setIsSyncing(true);
      await onSync();
      setIsSyncing(false);
      setStatus(`已批量应用并同步 ${updates.length} 个节点`);
    }
  };

  const undo = (nodeId: string) => {
    const list = historyMap[nodeId] || [];
    const cursor = historyCursor[nodeId] ?? (list.length - 1);
    if (cursor <= 0) return;
    const prev = list[cursor - 1];
    if (!prev) return;
    setDrafts(d => ({ ...d, [nodeId]: prev.fields }));
    setHistoryCursor(c => ({ ...c, [nodeId]: cursor - 1 }));
  };

  const redo = (nodeId: string) => {
    const list = historyMap[nodeId] || [];
    const cursor = historyCursor[nodeId] ?? (list.length - 1);
    if (cursor >= list.length - 1) return;
    const next = list[cursor + 1];
    if (!next) return;
    setDrafts(d => ({ ...d, [nodeId]: next.fields }));
    setHistoryCursor(c => ({ ...c, [nodeId]: cursor + 1 }));
  };

  const insertVariable = (node: AppNode, key: PromptFieldKey, variable: string) => {
    const current = getFieldValue(node, key);
    updateDraft(node, key, `${current}${current ? ' ' : ''}${variable}`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-6">
      <div className="w-full max-w-[1600px] h-[92vh] bg-[#121218] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-white/10 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-white font-semibold text-lg">工作流节点提示词管理</h2>
            <p className="text-xs text-slate-400">层级展示 · 实时编辑 · 一键应用 · 历史回溯</p>
          </div>
          <div className="flex items-center gap-2">
            {isSyncing ? <Clock3 size={14} className="text-cyan-400 animate-pulse" /> : <CheckCircle2 size={14} className="text-emerald-400" />}
            <button onClick={onClose} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-white/10 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-2.5 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索节点/提示词..."
                className="pl-8 pr-2 py-2 w-64 bg-black/30 border border-white/10 rounded-lg text-xs text-slate-200 outline-none focus:border-cyan-500/50"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as 'all' | 'changed' | 'hasPrompt')}
              className="px-2 py-2 bg-black/30 border border-white/10 rounded-lg text-xs text-slate-200"
            >
              <option value="all">全部节点</option>
              <option value="hasPrompt">仅有提示词</option>
              <option value="changed">仅已修改</option>
            </select>
            <span className="text-xs text-slate-400">共 {flatNodes.length} / {nodes.length} 节点</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={applySelected}
              className="px-3 py-2 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs hover:bg-cyan-500/30"
            >
              一键应用选中 ({selectedNodeIds.length})
            </button>
          </div>
        </div>

        {(error || status) && (
          <div className={`mx-4 mt-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${error ? 'bg-red-500/10 text-red-300 border border-red-500/30' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'}`}>
            {error ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            <span>{error || status}</span>
          </div>
        )}

        <div className="flex-1 overflow-auto p-4 space-y-3">
          {visibleNodes.map(node => {
            const depth = hierarchyDepth.get(node.id) ?? 0;
            const changed = Object.keys(drafts[node.id] || {}).length > 0;
            const historyCount = historyMap[node.id]?.length || 0;

            return (
              <div
                key={node.id}
                style={{ marginLeft: Math.min(depth * 24, 160) }}
                className={`border rounded-xl p-3 md:p-4 ${changed ? 'border-cyan-500/40 bg-cyan-500/5' : 'border-white/10 bg-white/5'}`}
              >
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedNodeIds.includes(node.id)}
                      onChange={(e) => {
                        setSelectedNodeIds(prev => e.target.checked ? [...new Set([...prev, node.id])] : prev.filter(id => id !== node.id));
                      }}
                    />
                    <span className="text-sm text-white font-medium">{node.title}</span>
                    <span className="text-[10px] text-slate-500">#{node.id.slice(-8)}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-slate-300">层级 {depth + 1}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button onClick={() => undo(node.id)} className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-300" title="撤销"><Undo2 size={13} /></button>
                    <button onClick={() => redo(node.id)} className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-slate-300" title="重做"><Redo2 size={13} /></button>
                    <button onClick={() => applySingle(node)} className="px-2 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs hover:bg-emerald-500/30">应用</button>
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {PROMPT_FIELDS.map(field => (
                    <div key={field.key} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-slate-300">{field.label}</label>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => insertVariable(node, field.key, VARIABLE_SNIPPETS[0])}
                            className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 text-[10px] hover:bg-purple-500/25"
                            title="插入变量"
                          >
                            <Wand2 size={11} />
                          </button>
                          <button
                            onClick={() => navigator.clipboard.writeText(getFieldValue(node, field.key))}
                            className="px-1.5 py-0.5 rounded bg-white/10 text-slate-300 text-[10px] hover:bg-white/20"
                            title="复制"
                          >
                            <Copy size={11} />
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={getFieldValue(node, field.key)}
                        onChange={(e) => updateDraft(node, field.key, e.target.value)}
                        placeholder={field.placeholder}
                        className="w-full h-24 px-2 py-2 bg-black/40 border border-white/10 rounded-lg text-xs text-slate-200 outline-none focus:border-cyan-500/50 resize-y"
                      />
                      <div className="flex items-center gap-1 flex-wrap">
                        {VARIABLE_SNIPPETS.map(item => (
                          <button
                            key={item}
                            onClick={() => insertVariable(node, field.key, item)}
                            className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] text-slate-300"
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 text-[11px] text-slate-500 flex items-center gap-1">
                  <History size={12} />
                  <span>历史版本 {historyCount} 条（自动记录编辑快照）</span>
                </div>
              </div>
            );
          })}

          {flatNodes.length > visibleNodes.length && (
            <div className="flex justify-center">
              <button
                onClick={() => setRenderLimit(v => v + 120)}
                className="px-4 py-2 rounded-lg bg-white/10 text-slate-300 text-xs hover:bg-white/20"
              >
                加载更多节点（当前 {visibleNodes.length}/{flatNodes.length}）
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

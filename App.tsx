/**
 * AIYOU 漫剧生成平台 - 主应用组件
 *
 * @developer 光波 (a@ggbo.com)
 * @copyright Copyright (c) 2025 光波. All rights reserved.
 * @license MIT
 * @description AI驱动的一站式漫剧创作平台，支持剧本创作、角色设计、分镜生成、视频制作
 */

// ... existing imports
import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { useLanguage } from './src/i18n/LanguageContext';
import { Node } from './components/Node';
import { SidebarDock } from './components/SidebarDock';
import { ModelFallbackNotification } from './components/ModelFallbackNotification';
import { NotificationToast } from './components/NotificationToast';
import { AppNode, NodeType, NodeStatus, ContextMenuState, Workflow, SmartSequenceItem, CharacterProfile, SoraTaskGroup } from './types';
// AI 服务层：动态导入（首次调用时加载，减少首屏 ~107KB gzip ~36KB）
// 详见 ./services/lazyServices.ts
import { getUserPriority, ModelCategory, getDefaultModel, getUserDefaultModel } from './services/modelConfig';
import { getGridConfig, STORYBOARD_RESOLUTIONS } from './services/storyboardConfig';
import { saveImageNodeOutput, saveVideoNodeOutput, saveAudioNodeOutput, saveStoryboardGridOutput } from './utils/storageHelper';
import { checkImageNodeCache, checkVideoNodeCache, checkAudioNodeCache } from './utils/cacheChecker';
import { validateConnection, canExecuteNode } from './utils/nodeValidation';
import { WelcomeScreen } from './components/WelcomeScreen';
import { MemoizedConnectionLayer } from './components/ConnectionLayer';
import { CanvasContextMenu } from './components/CanvasContextMenu';
import { ApiKeyPrompt } from './components/ApiKeyPrompt';
import type { VideoSource } from './components/VideoEditor';
import { getNodeIcon, getNodeNameCN, getApproxNodeHeight, getNodeBounds } from './utils/nodeHelpers';
import { useCanvasState } from './hooks/useCanvasState';
import { useNodeOperations } from './hooks/useNodeOperations';
import { useHistory } from './hooks/useHistory';
import { createNodeQuery, useThrottle } from './hooks/usePerformanceOptimization';
import { useViewportCulling } from './hooks/useViewportCulling';
import { useWindowSize } from './hooks/useWindowSize';
import { useUIStore } from './stores/ui.store';
import { useEditorStore } from './stores/editor.store';
import { getProjects, getProject, createProject, isApiAvailable } from './services/api';
import { initSync, setSyncProjectId, setOnlineStatus } from './services/syncMiddleware';
import { useNodeActions } from './handlers/useNodeActions';
import { useWorkflowActions } from './handlers/useWorkflowActions';
import { uploadMediaToServer } from './services/mediaStorageService';
import { useKeyboardShortcuts } from './handlers/useKeyboardShortcuts';

// Lazy load large components
const VideoEditor = lazy(() => import('./components/VideoEditor').then(m => ({ default: m.VideoEditor })));
const ImageCropper = lazy(() => import('./components/ImageCropper').then(m => ({ default: m.ImageCropper })));
const SketchEditor = lazy(() => import('./components/SketchEditor').then(m => ({ default: m.SketchEditor })));
const SonicStudio = lazy(() => import('./components/SonicStudio').then(m => ({ default: m.SonicStudio })));
const CharacterLibrary = lazy(() => import('./components/CharacterLibrary').then(m => ({ default: m.CharacterLibrary })));
const CharacterDetailModal = lazy(() => import('./components/CharacterDetailModal').then(m => ({ default: m.CharacterDetailModal })));
const AssistantPanel = lazy(() => import('./components/AssistantPanel').then(m => ({ default: m.AssistantPanel })));
const SmartSequenceDock = lazy(() => import('./components/SmartSequenceDock').then(m => ({ default: m.SmartSequenceDock })));
const SettingsPanel = lazy(() => import('./components/SettingsPanel').then(m => ({ default: m.SettingsPanel })));
const DebugPanel = lazy(() => import('./components/DebugPanel').then(m => ({ default: m.DebugPanel })));
import {
    Plus, Copy, Trash2, Type, Image as ImageIcon, Video as VideoIcon,
    ScanFace, Brush, MousePointerClick, LayoutTemplate, X, Film, Link, RefreshCw, Upload,
    Minus, FolderHeart, Unplug, Sparkles, ChevronLeft, ChevronRight, Scan, Music, Mic2, Loader2, ScrollText, Clapperboard, User, BookOpen, Languages, HardDrive, Save
} from 'lucide-react';
import { ExpandedView } from './components/ExpandedView';
import { WorkflowPromptManager } from './components/WorkflowPromptManager';
import type { InputAsset } from './components/nodes/types';

// ... (Constants, Helpers, ExpandedView UNCHANGED) ...
const SPRING = "cubic-bezier(0.32, 0.72, 0, 1)";
const SNAP_THRESHOLD = 8; // Pixels for magnetic snap
const COLLISION_PADDING = 24; // Spacing when nodes bounce off each other

/**
 * 保存视频到服务器数据库
 * 注意：已禁用 IndexedDB 保存，直接使用 Sora URL 避免卡顿
 * @param videoUrl 视频 URL
 * @param taskId 任务 ID
 * @param taskNumber 任务编号
 * @param soraPrompt Sora 提示词
 * @returns videoId (直接返回 taskId)
 */
async function saveVideoToDatabase(videoUrl: string, taskId: string, taskNumber: number, soraPrompt: string): Promise<string> {
    // 直接返回 taskId，不保存到 IndexedDB 避免阻塞主线程
    return taskId;
}

// Helper to get image dimensions
const getImageDimensions = (src: string): Promise<{width: number, height: number}> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({width: img.width, height: img.height});
        img.onerror = reject;
        img.src = src;
    });
};

// ExpandedView extracted to ./components/ExpandedView.tsx

export const App = () => {
  const { language, setLanguage, t } = useLanguage();

  // ========== Hooks: 画布状态管理 ==========
  const canvas = useCanvasState();

  // ========== Hooks: 历史记录管理 ==========
  const historyManager = useHistory(50);

  // ========== Zustand Stores ==========
  const {
    isChatOpen, setIsChatOpen,
    isSketchEditorOpen, setIsSketchEditorOpen,
    isMultiFrameOpen, setIsMultiFrameOpen,
    isSonicStudioOpen, setIsSonicStudioOpen,
    isCharacterLibraryOpen, setIsCharacterLibraryOpen,
    isSettingsOpen, setIsSettingsOpen,
    isApiKeyPromptOpen, setIsApiKeyPromptOpen,
    isDebugOpen, setIsDebugOpen,
    isVideoEditorOpen, setIsVideoEditorOpen,
    viewingCharacter, setViewingCharacter,
    videoEditorSources, setVideoEditorSources,
    expandedMedia, setExpandedMedia,
    contextMenu, setContextMenu,
    contextMenuTarget, setContextMenuTarget,
    storageReconnectNeeded, setStorageReconnectNeeded,
    croppingNodeId, setCroppingNodeId,
    imageToCrop, setImageToCrop,
  } = useUIStore();

  const {
    workflows, setWorkflows,
    assetHistory, setAssetHistory,
    selectedWorkflowId, setSelectedWorkflowId,
    isLoaded, setIsLoaded, isLoadingWorkflow,
    nodes, setNodes,
    connections, setConnections,
    groups, setGroups,
    clipboard, setClipboard,
    selectedNodeIds, setSelectedNodeIds,
    selectedGroupId, setSelectedGroupId,
    draggingNodeId, setDraggingNodeId,
    draggingNodeParentGroupId, setDraggingNodeParentGroupId,
    draggingGroup, setDraggingGroup,
    resizingGroupId, setResizingGroupId,
    activeGroupNodeIds, setActiveGroupNodeIds,
    connectionStart, setConnectionStart,
    selectionRect, setSelectionRect,
    resizingNodeId, setResizingNodeId,
    initialSize, setInitialSize,
    resizeStartPos, setResizeStartPos,
  } = useEditorStore();

  // ========== Hooks: 画布虚拟化（只渲染视口内节点） ==========
  const windowSize = useWindowSize();
  const visibleNodes = useViewportCulling(
    nodes,
    canvas.pan,
    canvas.scale,
    windowSize.width,
    windowSize.height
  );

  // Long press for canvas drag
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const longPressStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const isLongPressDraggingRef = useRef(false);

  const nodesRef = useRef(nodes);
  const connectionsRef = useRef(connections);
  const groupsRef = useRef(groups);
  const connectionStartRef = useRef(connectionStart);

  // AbortController 存储（用于取消视频生成任务）
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  // 性能优化：创建轻量级的节点查询函数
  // 避免传递整个nodes数组导致所有节点重渲染
  const nodeQuery = useRef(createNodeQuery(nodesRef));
  const rafRef = useRef<number | null>(null); 
  const replaceVideoInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const replacementTargetRef = useRef<string | null>(null);
  
  const dragNodeRef = useRef<{
      id: string,
      startX: number,
      startY: number,
      mouseStartX: number,
      mouseStartY: number,
      parentGroupId?: string | null,
      siblingNodeIds: string[],
      nodeWidth: number,
      nodeHeight: number,
      // 多选拖拽支持
      isMultiDrag?: boolean,
      selectedNodeIds?: string[],
      selectedNodesStartPos?: Array<{ id: string, x: number, y: number }>
  } | null>(null);

  const resizeContextRef = useRef<{
      nodeId: string,
      initialWidth: number,
      initialHeight: number,
      startX: number,
      startY: number,
      parentGroupId: string | null,
      siblingNodeIds: string[]
  } | null>(null);

  const selectionRectRef = useRef<any>(null);

  const [isPromptManagerOpen, setIsPromptManagerOpen] = useState(false);

  const dragGroupRef = useRef<{
      id: string, 
      startX: number, 
      startY: number, 
      mouseStartX: number, 
      mouseStartY: number,
      childNodes: {id: string, startX: number, startY: number}[]
  } | null>(null);

  useEffect(() => {
      nodesRef.current = nodes;
      connectionsRef.current = connections;
      groupsRef.current = groups;
      connectionStartRef.current = connectionStart;
  }, [nodes, connections, groups, connectionStart]);

  useEffect(() => {
      // 版权声明 - 光波开发

      if (window.aistudio) window.aistudio.hasSelectedApiKey().then(hasKey => { if (!hasKey) window.aistudio.openSelectKey(); });

      // Check if Gemini API Key is configured
      const checkApiKey = () => {
          const apiKey = localStorage.getItem('GEMINI_API_KEY');
          if (!apiKey || !apiKey.trim()) {
              // Show a gentle reminder after a short delay
              setTimeout(() => {
                  console.info('💡 提示：请在右上角设置按钮中配置您的 Gemini API Key 以使用 AI 功能');
              }, 2000);
          }
      };
      checkApiKey();

      const loadData = async () => {
          try {
            const apiOnline = await initSync();

            if (apiOnline) {
              const projectsRes = await getProjects();
              let projectId: string | null = null;

              if (projectsRes.success && projectsRes.data && projectsRes.data.length > 0) {
                // 从数据库项目列表构建工作流列表
                const dbWorkflows: Workflow[] = projectsRes.data.map((p: any) => ({
                  id: `wf-db-${p.id}`,
                  title: p.title,
                  thumbnail: '',
                  nodes: [],
                  connections: [],
                  groups: [],
                  projectId: p.id,
                }));
                setWorkflows(dbWorkflows);
                projectId = projectsRes.data[0].id;
              } else {
                // 没有项目，创建默认项目
                const createRes = await createProject('默认项目');
                if (createRes.success && createRes.data) {
                  projectId = createRes.data.id;
                  setWorkflows([{
                    id: `wf-db-${projectId}`,
                    title: '默认项目',
                    thumbnail: '',
                    nodes: [], connections: [], groups: [],
                    projectId,
                  }]);
                }
              }

              if (projectId) {
                setSyncProjectId(projectId);
                setOnlineStatus(true);
                const projectRes = await getProject(projectId);
                if (projectRes.success && projectRes.data) {
                  const { nodes: dbNodes, connections: dbConns, groups: dbGroups } = projectRes.data;
                  if (dbNodes && dbNodes.length > 0) {
                    const mappedNodes = dbNodes.map((n: any) => {
                      let data = n.data || {};
                      if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = {}; } }
                      let inputs = n.inputs || [];
                      if (typeof inputs === 'string') { try { inputs = JSON.parse(inputs); } catch { inputs = []; } }
                      return { ...n, data, inputs, title: getNodeNameCN(n.type) };
                    });
                    const mappedConns = (dbConns || []).map((c: any) => ({
                      id: c.id, from: c.from_node || c.from, to: c.to_node || c.to,
                    }));
                    setNodes(mappedNodes);
                    setConnections(mappedConns);
                    setGroups(dbGroups || []);
                  }
                  // 数据库项目为空时画布也为空（这是正确的）
                }
              }
            } else {
              // 后端不可达，空画布
              setOnlineStatus(false);
              console.warn('[App] 后端不可达，画布为空');
            }
          } catch (e) {
            console.error("Failed to load from database", e);
          } finally {
            setIsLoaded(true);
          }
      };
      loadData();

      // ✅ 检查本地存储配置（仅记录日志，不自动连接）
      const checkStorageConfig = () => {
          try {
              const savedConfig = JSON.parse(localStorage.getItem('fileStorageConfig') || '{}');
              if (savedConfig.enabled && savedConfig.rootPath) {
                  // 可以在界面上显示一个提示徽章
                  setStorageReconnectNeeded(true);
              }
          } catch (error) {
              console.error('[App] 检查存储配置失败:', error);
          }
      };

      checkStorageConfig();
  }, []);

  // 恢复Sora视频生成轮询（刷新页面后）
  // 使用 ref 跟踪已恢复的任务，避免重复恢复
  const restoredTasksRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isLoaded) return;

    const restoreSoraPolling = async () => {

      // 找到所有Sora2节点
      const soraNodes = nodes.filter(n => n.type === NodeType.SORA_VIDEO_GENERATOR);

      for (const node of soraNodes) {
        const taskGroups = node.data.taskGroups || [];
        const generatingTasks = taskGroups.filter((tg: any) =>
          (tg.generationStatus === 'generating' || tg.generationStatus === 'uploading') &&
          tg.soraTaskId &&
          !restoredTasksRef.current.has(tg.soraTaskId) // 只恢复未恢复过的任务
        );

        if (generatingTasks.length === 0) continue;


        try {
          // 导入checkSoraTaskStatus函数
          const { checkSoraTaskStatus, pollSoraTaskUntilComplete } = await import('./services/soraService');

          // 对每个正在生成的任务恢复轮询
          for (const tg of generatingTasks) {
            // 标记为已恢复，防止重复恢复
            restoredTasksRef.current.add(tg.soraTaskId);


            try {
              // 先查询一次当前状态，检查是否应该恢复轮询
              const initialResult = await checkSoraTaskStatus(
                tg.soraTaskId,
                undefined,
                { nodeId: node.id, nodeType: node.type }
              );

              // 检查任务是否已经太旧或处于异常状态
              const now = Math.floor(Date.now() / 1000);
              const taskCreatedAt = initialResult.created_at || now;
              const taskAge = now - taskCreatedAt;

              // 如果任务超过10分钟还在排队或处理中，不再恢复轮询
              if (taskAge > 600 && (initialResult.status === 'queued' || initialResult.status === 'processing')) {
                console.warn(`[恢复轮询] 任务 ${tg.taskNumber} 已经过旧(${Math.floor(taskAge / 60)}分钟)，状态仍为 ${initialResult.status}，停止轮询`);
                // 标记为失败
                setNodes(prevNodes => {
                  return prevNodes.map(n => {
                    if (n.id === node.id) {
                      const updatedTaskGroups = n.data.taskGroups.map((t: any) => {
                        if (t.id === tg.id) {
                          return {
                            ...t,
                            generationStatus: 'failed' as const,
                            error: `任务超时(${Math.floor(taskAge / 60)}分钟，状态: ${initialResult.status})`
                          };
                        }
                        return t;
                      });
                      return { ...n, data: { ...n.data, taskGroups: updatedTaskGroups } };
                    }
                    return n;
                  });
                });
                continue;
              }

              // 如果任务已经失败或完成，直接更新状态
              if (initialResult.status === 'error' || initialResult.status === 'failed' || initialResult.status === 'FAILED') {
                setNodes(prevNodes => {
                  return prevNodes.map(n => {
                    if (n.id === node.id) {
                      const updatedTaskGroups = n.data.taskGroups.map((t: any) => {
                        if (t.id === tg.id) {
                          return { ...t, generationStatus: 'failed' as const, error: '任务失败' };
                        }
                        return t;
                      });
                      return { ...n, data: { ...n.data, taskGroups: updatedTaskGroups } };
                    }
                    return n;
                  });
                });
                continue;
              }

              if (initialResult.status === 'completed' || initialResult.status === 'succeeded' || initialResult.status === 'success') {
                setNodes(prevNodes => {
                  return prevNodes.map(n => {
                    if (n.id === node.id) {
                      const updatedTaskGroups = n.data.taskGroups.map((t: any) => {
                        if (t.id === tg.id) {
                          return { ...t, generationStatus: 'completed' as const, videoUri: initialResult.videoUrl };
                        }
                        return t;
                      });
                      return { ...n, data: { ...n.data, taskGroups: updatedTaskGroups } };
                    }
                    return n;
                  });
                });
                continue;
              }

              // 任务仍在进行中，开始轮询

              // 使用轮询函数持续查询状态
              const result = await pollSoraTaskUntilComplete(
                tg.soraTaskId,
                (progress) => {
                  // 更新进度
                  setNodes(prevNodes => {
                    return prevNodes.map(n => {
                      if (n.id === node.id) {
                        const updatedTaskGroups = n.data.taskGroups.map((t: any) =>
                          t.id === tg.id ? { ...t, progress } : t
                        );
                        return { ...n, data: { ...n.data, taskGroups: updatedTaskGroups } };
                      }
                      return n;
                    });
                  });
                },
                5000, // 5秒轮询间隔
                { nodeId: node.id, nodeType: node.type }
              );

              // 更新最终状态

              setNodes(prevNodes => {
                return prevNodes.map(n => {
                  if (n.id === node.id) {
                    const updatedTaskGroups = n.data.taskGroups.map((t: any) => {
                      if (t.id === tg.id) {
                        if (result.status === 'completed') {
                          return {
                            ...t,
                            generationStatus: 'completed' as const,
                            progress: 100
                          };
                        } else if (result.status === 'error') {
                          const rawError = result.violationReason || result._rawData?.error || result._rawData?.message || '视频生成失败';
                          const errorMessage = typeof rawError === 'string' ? rawError : JSON.stringify(rawError);
                          return {
                            ...t,
                            generationStatus: 'failed' as const,
                            error: errorMessage
                          };
                        }
                      }
                      return t;
                    });
                    return { ...n, data: { ...n.data, taskGroups: updatedTaskGroups } };
                  }
                  return n;
                });
              });
            } catch (error) {
              console.error(`[恢复轮询] 任务组 ${tg.taskNumber} 轮询失败:`, error);
              // 标记为失败
              setNodes(prevNodes => {
                return prevNodes.map(n => {
                  if (n.id === node.id) {
                    const updatedTaskGroups = n.data.taskGroups.map((t: any) => {
                      if (t.id === tg.id) {
                        return {
                          ...t,
                          generationStatus: 'failed' as const,
                          error: '轮询失败: ' + (error as any).message
                        };
                      }
                      return t;
                    });
                    return { ...n, data: { ...n.data, taskGroups: updatedTaskGroups } };
                  }
                  return n;
                });
              });
            }
          }
        } catch (error) {
          console.error(`[恢复轮询] 恢复轮询失败:`, error);
        }
      }
    };

    // 延迟执行，确保节点完全加载
    const timeoutId = setTimeout(restoreSoraPolling, 1000);

    return () => clearTimeout(timeoutId);
  }, [isLoaded]); // 移除 nodes 依赖，避免循环触发


  const getNodeNameCN = (type: string) => {
      switch(type) {
          case NodeType.PROMPT_INPUT: return t.nodes.promptInput;
          case NodeType.VIDEO_GENERATOR: return t.nodes.videoGenerator;
          case NodeType.AUDIO_GENERATOR: return t.nodes.audioGenerator;
          case NodeType.VIDEO_ANALYZER: return t.nodes.videoAnalyzer;
          case NodeType.IMAGE_EDITOR: return t.nodes.imageEditor;
          case NodeType.SCRIPT_PLANNER: return t.nodes.scriptPlanner;
          case NodeType.SCRIPT_EPISODE: return t.nodes.scriptEpisode;
          case NodeType.STORYBOARD_GENERATOR: return t.nodes.storyboardGenerator;
          case NodeType.STORYBOARD_IMAGE: return '分镜图设计';
          case NodeType.STORYBOARD_SPLITTER: return '分镜图拆解';
          case NodeType.SORA_VIDEO_GENERATOR: return 'Sora 2 视频';
          case NodeType.SORA_VIDEO_CHILD: return 'Sora 2 视频结果';
          case NodeType.CHARACTER_NODE: return t.nodes.characterNode;
          case NodeType.DRAMA_ANALYZER: return '剧目分析';
          case NodeType.DRAMA_REFINED: return '剧目精炼';
          case NodeType.STYLE_PRESET: return '全局风格';
          default: return type;
      }
  };

  // Global error handler for API calls
  const handleApiError = useCallback((error: any, nodeId?: string) => {
      const errorMessage = error?.message || String(error);

      // Check if error is due to missing API Key
      if (errorMessage.includes('GEMINI_API_KEY_NOT_CONFIGURED')) {
          // Open API Key prompt dialog
          setIsApiKeyPromptOpen(true);

          // Update node status if nodeId is provided
          if (nodeId) {
              setNodes(prev => prev.map(n =>
                  n.id === nodeId
                      ? {
                          ...n,
                          status: NodeStatus.ERROR,
                          data: { ...n.data, error: '请先配置 Gemini API Key' }
                      }
                      : n
              ));
          }

          return '请先配置 Gemini API Key';
      }

      return errorMessage;
  }, []);

  // Handle API Key save from prompt
  const handleApiKeySave = useCallback((apiKey: string) => {
      localStorage.setItem('GEMINI_API_KEY', apiKey);
      setIsApiKeyPromptOpen(false);
      console.info('✅ Gemini API Key 已保存成功！');
  }, []);

  const handleFitView = useCallback(() => {
      if (nodes.length === 0) {
          canvas.resetCanvas();
          return;
      }
      const padding = 100;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach(n => {
          const h = n.height || getApproxNodeHeight(n);
          const w = n.width || 420;
          if (n.x < minX) minX = n.x;
          if (n.y < minY) minY = n.y;
          if (n.x + w > maxX) maxX = n.x + w;
          if (n.y + h > maxY) maxY = n.y + h;
      });
      const contentW = maxX - minX;
      const contentH = maxY - minY;
      const scaleX = (window.innerWidth - padding * 2) / contentW;
      const scaleY = (window.innerHeight - padding * 2) / contentH;
      let newScale = Math.min(scaleX, scaleY, 1);
      newScale = Math.max(0.2, newScale);
      const contentCenterX = minX + contentW / 2;
      const contentCenterY = minY + contentH / 2;
      const newPanX = (window.innerWidth / 2) - (contentCenterX * newScale);
      const newPanY = (window.innerHeight / 2) - (contentCenterY * newScale);
      canvas.setPan({ x: newPanX, y: newPanY });
      canvas.setScale(newScale);
  }, [nodes, canvas]);

  const saveHistory = useCallback(() => {
      try {
          historyManager.saveToHistory(
              nodesRef.current,
              connectionsRef.current,
              groupsRef.current
          );
      } catch (e) {
          console.warn("History save failed:", e);
      }
  }, [historyManager]);

  // 防抖版本的历史保存（1秒内多次调用只保存一次）
  const debouncedSaveHistoryRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedSaveHistory = useCallback(() => {
      if (debouncedSaveHistoryRef.current) {
          clearTimeout(debouncedSaveHistoryRef.current);
      }
      debouncedSaveHistoryRef.current = setTimeout(() => {
          saveHistory();
          debouncedSaveHistoryRef.current = null;
      }, 1000); // 1秒防抖
  }, [saveHistory]);

  // 组件卸载时保存待处理的历史
  useEffect(() => {
      return () => {
          if (debouncedSaveHistoryRef.current) {
              clearTimeout(debouncedSaveHistoryRef.current);
              saveHistory();
          }
      };
  }, [saveHistory]);

  const undo = useCallback(() => {
      const prevState = historyManager.undo();
      if (prevState) {
          setNodes(prevState.nodes);
          setConnections(prevState.connections);
          setGroups(prevState.groups);
      }
  }, [historyManager]);

  const deleteNodes = useCallback((ids: string[]) => { 
      if (ids.length === 0) return;
      saveHistory(); 
      setNodes(p => p.filter(n => !ids.includes(n.id)).map(n => ({...n, inputs: n.inputs.filter(i => !ids.includes(i))}))); 
      setConnections(p => p.filter(c => !ids.includes(c.from) && !ids.includes(c.to))); 
      setSelectedNodeIds([]); 
  }, [saveHistory]);

  const addNode = useCallback((type: NodeType, x?: number, y?: number, initialData?: any) => {
      if (type === NodeType.IMAGE_EDITOR) {
          setIsSketchEditorOpen(true);
          return;
      }
      try { saveHistory(); } catch (e) { }

      // 根据节点类型选择合适的默认模型
      const getDefaultModel = () => {
          switch (type) {
              // 视频生成节点
              case NodeType.VIDEO_GENERATOR:
                  return getUserDefaultModel('video');

              // 图片生成节点
              case NodeType.STORYBOARD_IMAGE:
                  return getUserDefaultModel('image');

              // 音频生成节点
              case NodeType.AUDIO_GENERATOR:
                  return getUserDefaultModel('audio');

              // 文本处理节点（分析、剧本等）
              case NodeType.VIDEO_ANALYZER:
              case NodeType.SCRIPT_PLANNER:
              case NodeType.SCRIPT_EPISODE:
              case NodeType.STORYBOARD_GENERATOR:
              case NodeType.CHARACTER_NODE:
              case NodeType.DRAMA_ANALYZER:
              case NodeType.STYLE_PRESET:
                  return getUserDefaultModel('text');

              // 其他节点根据是否包含 IMAGE 判断
              default:
                  return type.includes('IMAGE') ? getUserDefaultModel('image') : getUserDefaultModel('text');
          }
      };

      const defaults: any = {
          model: getDefaultModel(),
          generationMode: type === NodeType.VIDEO_GENERATOR ? 'DEFAULT' : undefined,
          scriptEpisodes: type === NodeType.SCRIPT_PLANNER ? 10 : undefined,
          scriptDuration: type === NodeType.SCRIPT_PLANNER ? 1 : undefined,
          scriptVisualStyle: type === NodeType.SCRIPT_PLANNER ? 'REAL' : undefined,
          episodeSplitCount: type === NodeType.SCRIPT_EPISODE ? 3 : undefined,
          storyboardCount: type === NodeType.STORYBOARD_GENERATOR ? 6 : undefined,
          storyboardDuration: type === NodeType.STORYBOARD_GENERATOR ? 4 : undefined,
          storyboardStyle: type === NodeType.STORYBOARD_GENERATOR ? 'REAL' : undefined,
          ...initialData
      };

      const safeX = x !== undefined ? x : (-canvas.pan.x + window.innerWidth/2)/canvas.scale - 210;
      const safeY = y !== undefined ? y : (-canvas.pan.y + window.innerHeight/2)/canvas.scale - 180;

      const newNode: AppNode = {
        id: `n-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        type,
        x: isNaN(safeX) ? 100 : safeX,
        y: isNaN(safeY) ? 100 : safeY,
        width: 420,
        title: getNodeNameCN(type),
        status: NodeStatus.IDLE,
        data: defaults,
        inputs: []
      };
      setNodes(prev => [...prev, newNode]);
  }, [canvas, saveHistory]);

  const handleAssetGenerated = useCallback((type: 'image' | 'video' | 'audio', src: string, title: string) => {
      setAssetHistory(h => {
          const exists = h.find(a => a.src === src);
          if (exists) return h;
          return [{ id: `a-${Date.now()}`, type, src, title, timestamp: Date.now() }, ...h];
      });
  }, []);
  
  const handleSketchResult = (type: 'image' | 'video', result: string, prompt: string) => {
      const centerX = (-canvas.pan.x + window.innerWidth/2)/canvas.scale - 210;
      const centerY = (-canvas.pan.y + window.innerHeight/2)/canvas.scale - 180;
      if (type === 'image') {
          // IMAGE_GENERATOR removed - images can be added as assets
          handleAssetGenerated(type, result, prompt || 'Sketch Output');
      } else {
          addNode(NodeType.VIDEO_GENERATOR, centerX, centerY, { videoUri: result, prompt, status: NodeStatus.SUCCESS });
      }
      handleAssetGenerated(type, result, prompt || 'Sketch Output');
  };

  const handleMultiFrameGenerate = async (frames: SmartSequenceItem[]): Promise<string> => {
      const { compileMultiFramePrompt, generateVideo } = await import('./services/geminiService');
      const complexPrompt = compileMultiFramePrompt(frames as any[]);
      try {
          const res = await generateVideo(
              complexPrompt, 
              'veo-3.1-generate-preview', 
              { aspectRatio: '16:9', count: 1 },
              frames[0].src, 
              null,
              frames.length > 1 ? frames.map(f => f.src) : undefined 
          );
          if (res.isFallbackImage) {
              handleAssetGenerated('image', res.uri, 'Smart Sequence Preview (Fallback)');
          } else {
              handleAssetGenerated('video', res.uri, 'Smart Sequence');
          }
          return res.uri;
      } catch (e: any) {
          throw new Error(e.message || "Smart Sequence Generation Failed");
      }
  };

  const handleWheel = useCallback((e: WheelEvent) => {
      // 如果滚轮事件发生在节点内部，不处理（让节点自己滚动）
      const target = e.target as HTMLElement;
      const nodeElement = target.closest('[data-node-container]');
      if (nodeElement) {
        return;
      }

      // 阻止浏览器默认行为（如页面缩放）
      e.preventDefault();

      // 滚轮直接缩放画布，以鼠标位置为中心点
      const delta = -e.deltaY * 0.001;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      canvas.zoomCanvas(delta, x, y);
  }, [canvas]);

  // 手动添加非被动的 wheel 事件监听器（避免 preventDefault 警告）
  const canvasRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
      const element = canvasRef.current;
      if (!element) return;

      const handleWheelEvent = (e: WheelEvent) => {
          handleWheel(e);
      };

      // 添加非被动的监听器
      element.addEventListener('wheel', handleWheelEvent, { passive: false });

      return () => {
          element.removeEventListener('wheel', handleWheelEvent);
      };
  }, [handleWheel]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
      if (contextMenu) setContextMenu(null);
      setSelectedGroupId(null);

      // 左键点击空白画布：直接拖拽画布
      // 中键点击：也拖拽画布（保留兼容）
      if (e.button === 0 || e.button === 1) {
          // Shift+左键：框选模式
          if (e.button === 0 && e.shiftKey) {
              if (e.detail > 1) { e.preventDefault(); return; }
              setSelectedNodeIds([]);
              const rect = { startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY };
              setSelectionRect(rect);
              selectionRectRef.current = rect;
              return;
          }

          // 左键 / 中键：直接开始拖拽画布
          setSelectedNodeIds([]);
          canvas.startCanvasDrag(e.clientX, e.clientY);
          return;
      }
  }, [contextMenu, canvas]);

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
      const { clientX, clientY } = e;

      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          canvas.updateMousePos(clientX, clientY);

          // Only commit mousePos to state when actively creating a connection
          // (ConnectionLayer needs mousePos as a prop to render the dragging line)
          if (connectionStartRef.current) {
              canvas.commitMousePos();
          }

          if (selectionRectRef.current) {
              const updated = { ...selectionRectRef.current, currentX: clientX, currentY: clientY };
              selectionRectRef.current = updated;
              setSelectionRect(updated);
              return;
          }

          if (dragGroupRef.current) {
              const { id, startX, startY, mouseStartX, mouseStartY, childNodes } = dragGroupRef.current;
              const dx = (clientX - mouseStartX) / canvas.scale;
              const dy = (clientY - mouseStartY) / canvas.scale;
              setGroups(prev => prev.map(g => g.id === id ? { ...g, x: startX + dx, y: startY + dy } : g));
              if (childNodes.length > 0) {
                  setNodes(prev => prev.map(n => {
                      const child = childNodes.find(c => c.id === n.id);
                      return child ? { ...n, x: child.startX + dx, y: child.startY + dy } : n;
                  }));
              }
              return;
          }

          if (canvas.isDraggingCanvas) {
              canvas.dragCanvas(clientX, clientY);
          }

          if (draggingNodeId && dragNodeRef.current && dragNodeRef.current.id === draggingNodeId) {
             const { startX, startY, mouseStartX, mouseStartY, nodeWidth, nodeHeight, isMultiDrag, selectedNodeIds, selectedNodesStartPos } = dragNodeRef.current;
             let dx = (clientX - mouseStartX) / canvas.scale;
             let dy = (clientY - mouseStartY) / canvas.scale;
             let proposedX = startX + dx;
             let proposedY = startY + dy;

             // 磁吸对齐（只对主拖拽节点进行）
             const SNAP = SNAP_THRESHOLD / canvas.scale;
             const myL = proposedX; const myC = proposedX + nodeWidth / 2; const myR = proposedX + nodeWidth;
             const myT = proposedY; const myM = proposedY + nodeHeight / 2; const myB = proposedY + nodeHeight;
             let snappedX = false; let snappedY = false;
             nodesRef.current.forEach(other => {
                 // 多选时跳过其他选中的节点
                 if (isMultiDrag && selectedNodeIds?.includes(other.id)) return;
                 if (other.id === draggingNodeId) return;
                 const otherBounds = getNodeBounds(other);
                 if (!snappedX) {
                     if (Math.abs(myL - otherBounds.x) < SNAP) { proposedX = otherBounds.x; snappedX = true; }
                     else if (Math.abs(myL - otherBounds.right) < SNAP) { proposedX = otherBounds.right; snappedX = true; }
                     else if (Math.abs(myR - otherBounds.x) < SNAP) { proposedX = otherBounds.x - nodeWidth; snappedX = true; }
                     else if (Math.abs(myR - otherBounds.right) < SNAP) { proposedX = otherBounds.right - nodeWidth; snappedX = true; }
                     else if (Math.abs(myC - (otherBounds.x+otherBounds.width/2)) < SNAP) { proposedX = (otherBounds.x+otherBounds.width/2) - nodeWidth/2; snappedX = true; }
                 }
                 if (!snappedY) {
                     if (Math.abs(myT - otherBounds.y) < SNAP) { proposedY = otherBounds.y; snappedY = true; }
                     else if (Math.abs(myT - otherBounds.bottom) < SNAP) { proposedY = otherBounds.bottom; snappedY = true; }
                     else if (Math.abs(myB - otherBounds.y) < SNAP) { proposedY = otherBounds.y - nodeHeight; snappedY = true; }
                     else if (Math.abs(myB - otherBounds.bottom) < SNAP) { proposedY = otherBounds.bottom - nodeHeight; snappedY = true; }
                     else if (Math.abs(myM - (otherBounds.y+otherBounds.height/2)) < SNAP) { proposedY = (otherBounds.y+otherBounds.height/2) - nodeHeight/2; snappedY = true; }
                 }
             });

             // 计算最终位移（考虑磁吸）
             const finalDx = proposedX - startX;
             const finalDy = proposedY - startY;

             if (isMultiDrag && selectedNodeIds && selectedNodesStartPos) {
                 // 多选拖拽：移动所有选中的节点
                 setNodes(prev => prev.map(n => {
                     if (selectedNodeIds.includes(n.id)) {
                         const startPos = selectedNodesStartPos.find(p => p.id === n.id);
                         if (startPos) {
                             return { ...n, x: startPos.x + finalDx, y: startPos.y + finalDy };
                         }
                     }
                     return n;
                 }));
             } else {
                 // 单个节点拖拽
                 setNodes(prev => prev.map(n => n.id === draggingNodeId ? { ...n, x: proposedX, y: proposedY } : n));
             }
          }

          if (resizingNodeId && initialSize && resizeStartPos) {
              const dx = (clientX - resizeStartPos.x) / canvas.scale;
              const dy = (clientY - resizeStartPos.y) / canvas.scale;
              setNodes(prev => prev.map(n => n.id === resizingNodeId ? { ...n, width: Math.max(360, initialSize.width + dx), height: Math.max(240, initialSize.height + dy) } : n));
          }
      });
  }, [canvas, draggingNodeId, resizingNodeId, initialSize, resizeStartPos]);

  const handleGlobalMouseUp = useCallback(() => {
      // Clear long press timer
      if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
      }
      longPressStartPosRef.current = null;
      isLongPressDraggingRef.current = false;

      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      if (selectionRectRef.current) {
          const sr = selectionRectRef.current;
          const x = Math.min(sr.startX, sr.currentX);
          const y = Math.min(sr.startY, sr.currentY);
          const w = Math.abs(sr.currentX - sr.startX);
          const h = Math.abs(sr.currentY - sr.startY);
          if (w > 10) {
              const rect = {
                  x: (x - canvas.pan.x) / canvas.scale,
                  y: (y - canvas.pan.y) / canvas.scale,
                  w: w / canvas.scale,
                  h: h / canvas.scale
              };
              const enclosed = nodesRef.current.filter(n => {
                  const cx = n.x + (n.width||420)/2;
                  const cy = n.y + 160;
                  return cx>rect.x && cx<rect.x+rect.w && cy>rect.y && cy<rect.y+rect.h;
              });
              if (enclosed.length > 0) {
                  // 选中框选的节点（移除自动创建分组的逻辑）
                  setSelectedNodeIds(enclosed.map(n => n.id));
              }
          }
          setSelectionRect(null);
          selectionRectRef.current = null;
      }
      if (draggingNodeId) {
          const draggedNode = nodesRef.current.find(n => n.id === draggingNodeId);
          if (draggedNode) {
              const myBounds = getNodeBounds(draggedNode);
              const otherNodes = nodesRef.current.filter(n => n.id !== draggingNodeId);
              for (const other of otherNodes) {
                  const otherBounds = getNodeBounds(other);
                  const isOverlapping = (myBounds.x < otherBounds.right && myBounds.right > otherBounds.x && myBounds.y < otherBounds.bottom && myBounds.bottom > otherBounds.y);
                  if (isOverlapping) {
                       const overlapLeft = myBounds.right - otherBounds.x;
                       const overlapRight = otherBounds.right - myBounds.x;
                       const overlapTop = myBounds.bottom - otherBounds.y;
                       const overlapBottom = otherBounds.bottom - myBounds.y;
                       const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);
                       if (minOverlap === overlapLeft) draggedNode.x = otherBounds.x - myBounds.width - COLLISION_PADDING;
                       else if (minOverlap === overlapRight) draggedNode.x = otherBounds.right + COLLISION_PADDING;
                       else if (minOverlap === overlapTop) draggedNode.y = otherBounds.y - myBounds.height - COLLISION_PADDING;
                       else if (minOverlap === overlapBottom) draggedNode.y = otherBounds.bottom + COLLISION_PADDING;
                       myBounds.x = draggedNode.x;
                       myBounds.y = draggedNode.y;
                       myBounds.right = draggedNode.x + myBounds.width;
                       myBounds.bottom = draggedNode.y + myBounds.height;
                  }
              }
              setNodes(prev => prev.map(n => n.id === draggingNodeId ? { ...n, x: draggedNode.x, y: draggedNode.y } : n));
          }
      }
      if (draggingNodeId || resizingNodeId || dragGroupRef.current) saveHistory();
      canvas.endCanvasDrag();
      setDraggingNodeId(null);
      setDraggingNodeParentGroupId(null);
      setDraggingGroup(null);
      setResizingGroupId(null);
      setActiveGroupNodeIds([]);
      setResizingNodeId(null);
      setInitialSize(null);
      setResizeStartPos(null);
      setConnectionStart(null);
      dragNodeRef.current = null;
      resizeContextRef.current = null;
      dragGroupRef.current = null;
  }, [canvas, saveHistory, draggingNodeId, resizingNodeId]);

  useEffect(() => { window.addEventListener('mousemove', handleGlobalMouseMove); window.addEventListener('mouseup', handleGlobalMouseUp); return () => { window.removeEventListener('mousemove', handleGlobalMouseMove); window.removeEventListener('mouseup', handleGlobalMouseUp); }; }, [handleGlobalMouseMove, handleGlobalMouseUp]);

  const handleNodeUpdate = useCallback((id: string, data: any, size?: any, title?: string) => {
      const callingStack = new Error().stack?.split('\n').slice(1, 4).join('\n');

      setNodes(prev => prev.map(n => {
          if (n.id === id) {
              // 确保标题始终是中文的
              const correctTitle = getNodeNameCN(n.type);
              const updated = { ...n, data: { ...n.data, ...data }, title: title || correctTitle };

              // Debug log for character updates
              if (data.generatedCharacters) {
              }

              if (size) { if (size.width) updated.width = size.width; if (size.height) updated.height = size.height; }
              if (data.image) handleAssetGenerated('image', data.image, updated.title);
              if (data.videoUri) handleAssetGenerated('video', data.videoUri, updated.title);
              if (data.audioUri) handleAssetGenerated('audio', data.audioUri, updated.title);
              return updated;
          }
          return n;
      }));
  }, [handleAssetGenerated]);


  const applyPromptToNode = useCallback(async (nodeId: string, prompt: string) => {
      handleNodeUpdate(nodeId, { prompt });
  }, [handleNodeUpdate]);

  const applyPromptBatch = useCallback(async (updates: Array<{ nodeId: string; prompt: string }>) => {
      updates.forEach((update) => {
          handleNodeUpdate(update.nodeId, { prompt: update.prompt });
      });
  }, [handleNodeUpdate]);

  const handleReplaceFile = useCallback((e: React.ChangeEvent<HTMLInputElement>, type: 'image' | 'video') => {
      const file = e.target.files?.[0];
      const targetId = replacementTargetRef.current;
      if (file && targetId) {
          const reader = new FileReader();
          reader.onload = async (ev) => {
              const base64 = ev.target?.result as string;
              const url = await uploadMediaToServer(base64, { nodeId: targetId, type });
              if (type === 'image') handleNodeUpdate(targetId, { image: url });
              else handleNodeUpdate(targetId, { videoUri: url });
          };
          reader.readAsDataURL(file);
      }
      e.target.value = ''; setContextMenu(null); replacementTargetRef.current = null;
  }, [handleNodeUpdate]);

  // Helper functions (getVisualPromptPrefix, getUpstreamContext, getUpstreamStyleContext) extracted to handlers/useNodeActions.ts

  // --- Character Action Handler ---
  const handleCharacterAction = useCallback(async (nodeId: string, action: 'DELETE' | 'SAVE' | 'RETRY' | 'GENERATE_EXPRESSION' | 'GENERATE_THREE_VIEW' | 'GENERATE_SINGLE', charName: string) => {
      const node = nodesRef.current.find(n => n.id === nodeId);
      if (!node) return;

      // Use new character action handler with queue-based state management
      const { handleCharacterAction: handleCharacterActionNew } = await import('./services/characterActionHandler');
      await handleCharacterActionNew(
          nodeId,
          action,
          charName,
          node,
          nodesRef.current,
          handleNodeUpdate
      );
  }, [handleNodeUpdate]);

  // --- Node Event Handlers (useCallback for performance) ---
  const handleNodeDelete = useCallback((id: string) => {
      deleteNodes([id]);
  }, []);

  const handleNodeExpand = useCallback((data: { type: 'image' | 'video', src: string, rect: DOMRect, images?: string[], initialIndex?: number }) => {
      setExpandedMedia(data);
  }, []);

  const handleNodeCrop = useCallback((id: string, img: string) => {
      setCroppingNodeId(id);
      setImageToCrop(img);
  }, []);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, id: string) => {
      e.stopPropagation();

      // 检查是否点击了交互元素，如果是则不触发节点拖拽
      const target = e.target as HTMLElement;
      const tagName = target.tagName;
      const targetType = target.getAttribute('type');

      // 交互元素列表：range input、普通input、textarea、select、button、a标签
      const isInteractiveElement =
          (tagName === 'INPUT' && (targetType === 'range' || targetType === 'text' || targetType === 'number' || targetType === 'checkbox' || targetType === 'radio')) ||
          tagName === 'TEXTAREA' ||
          tagName === 'SELECT' ||
          tagName === 'BUTTON' ||
          tagName === 'A';

      if (isInteractiveElement) {
          // 点击的是交互元素，不触发节点拖拽
          return;
      }

      const isAlreadySelected = selectedNodeIds.includes(id);

      // 如果按住shift/meta/ctrl键，切换选中状态
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
          setSelectedNodeIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
      } else if (!isAlreadySelected) {
          // 如果点击的节点未被选中，清除其他选中，只选中当前节点
          setSelectedNodeIds([id]);
      }
      // 如果点击的节点已经被选中，保持选中状态不变（支持多选拖拽）

      const n = nodesRef.current.find(x => x.id === id);
      if (!n) return;

      const w = n.width || 420;
      const h = n.height || getApproxNodeHeight(n);
      const cx = n.x + w/2;
      const cy = n.y + 160;
      const pGroup = groups.find(g => {
          return cx > g.x && cx < g.x + g.width && cy > g.y && cy < g.y + g.height;
      });

      let siblingNodeIds: string[] = [];
      if (pGroup) {
          siblingNodeIds = nodesRef.current.filter(other => {
              if (other.id === id) return false;
              const b = getNodeBounds(other);
              const ocx = b.x + b.width/2;
              const ocy = b.y + b.height/2;
              return ocx > pGroup.x && ocx < pGroup.x + pGroup.width && ocy > pGroup.y && ocy < pGroup.y + pGroup.height;
          }).map(s => s.id);
      }

      // 记录多选拖拽信息
      const currentSelectedIds = selectedNodeIds.includes(id) ? selectedNodeIds : [id];
      const isMultiDrag = currentSelectedIds.length > 1;
      const selectedNodesStartPos = isMultiDrag
          ? nodesRef.current.filter(node => currentSelectedIds.includes(node.id))
              .map(node => ({ id: node.id, x: node.x, y: node.y }))
          : [];

      dragNodeRef.current = {
          id,
          startX: n.x,
          startY: n.y,
          mouseStartX: e.clientX,
          mouseStartY: e.clientY,
          parentGroupId: pGroup?.id,
          siblingNodeIds,
          nodeWidth: w,
          nodeHeight: h,
          isMultiDrag,
          selectedNodeIds: currentSelectedIds,
          selectedNodesStartPos
      };
      setDraggingNodeParentGroupId(pGroup?.id || null);
      setDraggingNodeId(id);
  }, [selectedNodeIds, groups, getApproxNodeHeight, getNodeBounds]);

  const handlePortMouseDown = useCallback((e: React.MouseEvent, id: string, type: 'input' | 'output') => {
      e.stopPropagation();
      setConnectionStart({ id, x: e.clientX, y: e.clientY });
  }, []);

  const handlePortMouseUp = useCallback((e: React.MouseEvent, id: string, type: 'input' | 'output') => {
      e.stopPropagation();
      const start = connectionStartRef.current;
      if (!start || start.id === id) return;

      if (start.id === 'smart-sequence-dock') {
          // Smart Sequence Dock 的连接逻辑保持不变
          setConnectionStart(null);
          return;
      }

      // 获取源节点和目标节点
      const fromNode = nodesRef.current.find(n => n.id === start.id);
      const toNode = nodesRef.current.find(n => n.id === id);

      if (fromNode && toNode) {
          // 验证连接是否合法
          const validation = validateConnection(fromNode, toNode, connections);

          if (validation.valid) {
              // 连接合法,创建连接
              setConnections(p => [...p, { from: start.id, to: id }]);
              setNodes(p => p.map(n =>
                  n.id === id ? { ...n, inputs: [...n.inputs, start.id] } : n
              ));
          } else {
              // 连接不合法,显示错误提示
              alert(validation.error || '无法创建连接');
          }
      }

      setConnectionStart(null);
  }, [connections]);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      e.preventDefault();
      setContextMenu({ visible: true, x: e.clientX, y: e.clientY, id });
      setContextMenuTarget({ type: 'node', id });
  }, []);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, id: string, w: number, h: number) => {
      e.stopPropagation();
      const n = nodesRef.current.find(x => x.id === id);
      if (!n) return;

      const cx = n.x + w/2;
      const cy = n.y + 160;
      const pGroup = groups.find(g => {
          return cx > g.x && cx < g.x + g.width && cy > g.y && cy < g.y + g.height;
      });

      setDraggingNodeParentGroupId(pGroup?.id || null);

      let siblingNodeIds: string[] = [];
      if (pGroup) {
          siblingNodeIds = nodesRef.current.filter(other => {
              if (other.id === id) return false;
              const b = getNodeBounds(other);
              const ocx = b.x + b.width/2;
              const ocy = b.y + b.height/2;
              return ocx > pGroup.x && ocx < pGroup.x + pGroup.width && ocy > pGroup.y && ocy < pGroup.y + pGroup.height;
          }).map(s => s.id);
      }

      resizeContextRef.current = {
          nodeId: id,
          initialWidth: w,
          initialHeight: h,
          startX: e.clientX,
          startY: e.clientY,
          parentGroupId: pGroup?.id || null,
          siblingNodeIds
      };

      setResizingNodeId(id);
      setInitialSize({ width: w, height: h });
      setResizeStartPos({ x: e.clientX, y: e.clientY });
  }, [groups, getNodeBounds]);

  const handleInputReorder = useCallback((nodeId: string, newOrder: string[]) => {
      const node = nodesRef.current.find(n => n.id === nodeId);
      if (node) {
          setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, inputs: newOrder } : n));
      }
  }, []);

  const handleViewCharacter = useCallback((character: CharacterProfile) => {
      setViewingCharacter({ character, nodeId: '' }); // nodeId will be set by Node component
  }, []);

  // --- Helper: Calculate input assets for a node ---
  const getNodeInputAssets = useCallback((nodeId: string, inputs: string[]): InputAsset[] => {
      return inputs
          .map(i => nodesRef.current.find(n => n.id === i))
          .filter(n => n && (n.data.image || n.data.videoUri || n.data.croppedFrame))
          .slice(0, 6)
          .map(n => ({
              id: n!.id,
              type: (n!.data.croppedFrame || n!.data.image) ? 'image' : 'video',
              src: n!.data.croppedFrame || n!.data.image || n!.data.videoUri!
          }));
  }, []);

  // --- Video Editor Handler ---
  const handleOpenVideoEditor = useCallback((nodeId: string) => {

    const node = nodesRef.current.find(n => n.id === nodeId);
    if (!node) {
      console.error('[handleOpenVideoEditor] Node not found:', nodeId);
      return;
    }

    if (node.type !== NodeType.VIDEO_EDITOR) {
      console.error('[handleOpenVideoEditor] Invalid node type:', node.type);
      return;
    }


    // 获取连接的视频
    const sources: VideoSource[] = [];

    if (!nodeQuery.current) {
      console.error('[handleOpenVideoEditor] nodeQuery.current is null');
      return;
    }

    const connectedNodes = nodeQuery.current.getNodesByIds(node.inputs);

    for (const inputNode of connectedNodes) {
      let videoUrl = '';
      let duration = 0;

      switch (inputNode.type) {
        case NodeType.VIDEO_GENERATOR:
          videoUrl = inputNode.data.videoUri || inputNode.data.videoUris?.[0] || '';
          duration = inputNode.data.duration || 0;
          break;

        case NodeType.SORA_VIDEO_GENERATOR: {
          // Sora 2: 从子节点获取视频
          const allSoraChildren = nodeQuery.current.getNodesByType(NodeType.SORA_VIDEO_CHILD);
          const connectedSoraChildren = allSoraChildren.filter(child =>
            child.inputs && child.inputs.includes(inputNode.id)
          );

          for (const childNode of connectedSoraChildren) {
            if (childNode.data.videoUrl) {
              sources.push({
                id: childNode.id,
                url: childNode.data.videoUrl,
                name: `${inputNode.title} - ${childNode.data.taskNumber || '视频'}`,
                duration: childNode.data.duration || 0,
                sourceNodeId: inputNode.id
              });
            }
          }
          continue; // Sora 2 已处理，跳过后续
        }

        case NodeType.STORYBOARD_VIDEO_GENERATOR: {
          // 分镜视频：从子节点获取视频
          const allStoryboardChildren = nodeQuery.current.getNodesByType(NodeType.STORYBOARD_VIDEO_CHILD);
          const connectedStoryboardChildren = allStoryboardChildren.filter(child =>
            child.inputs && child.inputs.includes(inputNode.id)
          );

          for (const childNode of connectedStoryboardChildren) {
            if (childNode.data.videoUrl) {
              sources.push({
                id: childNode.id,
                url: childNode.data.videoUrl,
                name: `${inputNode.title} - ${childNode.data.selectedShotIndex !== undefined ? `镜头${childNode.data.selectedShotIndex + 1}` : '视频'}`,
                duration: childNode.data.duration || 0,
                sourceNodeId: inputNode.id
              });
            }
          }
          continue; // 分镜视频已处理，跳过后续
        }

        case NodeType.SORA_VIDEO_CHILD:
          videoUrl = inputNode.data.videoUrl || '';
          duration = inputNode.data.duration || 0;
          break;

        case NodeType.STORYBOARD_VIDEO_CHILD:
          videoUrl = inputNode.data.videoUrl || '';
          duration = inputNode.data.duration || 0;
          break;
      }

      if (videoUrl) {
        sources.push({
          id: inputNode.id,
          url: videoUrl,
          name: inputNode.title,
          duration,
          sourceNodeId: inputNode.id
        });
      }
    }


    setVideoEditorSources(sources);
    setIsVideoEditorOpen(true);
  }, []);

  // --- Main Action Handler (extracted to handlers/useNodeActions.ts) ---
  const { handleNodeAction } = useNodeActions({
    nodesRef,
    connectionsRef,
    abortControllersRef,
    nodeQuery,
    saveHistory,
    handleNodeUpdate,
    handleAssetGenerated,
  });

  // --- Workflow Actions (extracted to handlers/useWorkflowActions.ts) ---
  const { saveCurrentAsWorkflow, saveGroupAsWorkflow, loadWorkflow, deleteWorkflow, renameWorkflow, createNewWorkflow } = useWorkflowActions({
    saveHistory,
  });

  // Keyboard Shortcuts (extracted to handlers/useKeyboardShortcuts.ts)
  useKeyboardShortcuts({
    nodesRef,
    saveHistory,
    deleteNodes,
    undo,
    zoomCanvas: canvas.zoomCanvas,
    mousePosRef: canvas.mousePosRef,
  });

  const handleCanvasDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  const handleCanvasDrop = (e: React.DragEvent) => {
      e.preventDefault();
      const dropX = (e.clientX - canvas.pan.x) / canvas.scale;
      const dropY = (e.clientY - canvas.pan.y) / canvas.scale;
      const assetData = e.dataTransfer.getData('application/json');
      const workflowId = e.dataTransfer.getData('application/workflow-id');

      if (workflowId && workflows) {
          const wf = workflows.find(w => w.id === workflowId);
          if (wf) {
              saveHistory();
              const minX = Math.min(...wf.nodes.map(n => n.x));
              const minY = Math.min(...wf.nodes.map(n => n.y));
              const width = Math.max(...wf.nodes.map(n => n.x + (n.width||420))) - minX;
              const height = Math.max(...wf.nodes.map(n => n.y + 320)) - minY;
              const offsetX = dropX - (minX + width/2);
              const offsetY = dropY - (minY + height/2);
              const idMap = new Map<string, string>();
              const newNodes = wf.nodes.map(n => { const newId = `n-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`; idMap.set(n.id, newId); return { ...n, id: newId, x: n.x + offsetX, y: n.y + offsetY, status: NodeStatus.IDLE, inputs: [] }; });
              newNodes.forEach((n, i) => { const original = wf.nodes[i]; n.inputs = original.inputs.map(oldId => idMap.get(oldId)).filter(Boolean) as string[]; });
              const newConnections = wf.connections.map(c => ({ from: idMap.get(c.from)!, to: idMap.get(c.to)! })).filter(c => c.from && c.to);
              const newGroups = (wf.groups || []).map(g => ({ ...g, id: `g-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, x: g.x + offsetX, y: g.y + offsetY }));
              setNodes(prev => [...prev, ...newNodes]); setConnections(prev => [...prev, ...newConnections]); setGroups(prev => [...prev, ...newGroups]);
          }
          return;
      }
      if (assetData) {
          try {
              const asset = JSON.parse(assetData);
              if (asset && asset.type) {
                  if (asset.type === 'image') addNode(NodeType.IMAGE_GENERATOR, dropX - 210, dropY - 180, { image: asset.src, prompt: asset.title });
                  else if (asset.type === 'video') addNode(NodeType.VIDEO_GENERATOR, dropX - 210, dropY - 180, { videoUri: asset.src });
              }
              return;
          } catch (err) { console.error("Drop failed", err); }
      }
      
      // Updated Multi-File Logic (9-Grid Support)
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          const files = Array.from(e.dataTransfer.files) as File[];
          const validFiles = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
          
          if (validFiles.length > 0) {
              const COLS = 3; 
              const GAP = 40;
              const BASE_WIDTH = 420;
              const BASE_HEIGHT = 450; 
              
              const startX = dropX - 210; 
              const startY = dropY - 180;

              validFiles.forEach((file, index) => {
                  const col = index % COLS;
                  const row = Math.floor(index / COLS);
                  
                  const xPos = startX + (col * (BASE_WIDTH + GAP));
                  const yPos = startY + (row * BASE_HEIGHT);

                  const reader = new FileReader();
                  reader.onload = (event) => {
                      const res = event.target?.result as string;
                      if (file.type.startsWith('image/')) {
                          addNode(NodeType.IMAGE_GENERATOR, xPos, yPos, { image: res, prompt: file.name, status: NodeStatus.SUCCESS });
                      } else if (file.type.startsWith('video/')) {
                          addNode(NodeType.VIDEO_GENERATOR, xPos, yPos, { videoUri: res, prompt: file.name, status: NodeStatus.SUCCESS });
                      }
                  };
                  reader.readAsDataURL(file);
              });
          }
      }
  };
  
  useEffect(() => {
      const style = document.createElement('style');
      style.innerHTML = ` .cursor-grab-override, .cursor-grab-override * { cursor: grab !important; } .cursor-grab-override:active, .cursor-grab-override:active * { cursor: grabbing !important; } `;
      document.head.appendChild(style);
      return () => { document.head.removeChild(style); };
  }, []);

  return (
    <div className="w-screen h-screen overflow-hidden bg-[#0a0a0c]">
      <div
          ref={canvasRef}
          className={`w-full h-full overflow-hidden text-slate-200 selection:bg-cyan-500/30 ${canvas.isDraggingCanvas ? 'cursor-grabbing' : 'cursor-default'}`}
          onMouseDown={handleCanvasMouseDown}
          onDoubleClick={(e) => { e.preventDefault(); if (e.detail > 1 && !selectionRect) { setContextMenu({ visible: true, x: e.clientX, y: e.clientY, id: '' }); setContextMenuTarget({ type: 'create' }); } }}
          onContextMenu={(e) => { e.preventDefault(); if(e.target === e.currentTarget) setContextMenu(null); }}
          onDragOver={handleCanvasDragOver} onDrop={handleCanvasDrop}
      >
          <div className="absolute inset-0 noise-bg" />
          <div ref={canvas.gridBgRef} className="absolute inset-0 pointer-events-none opacity-[0.06]" style={{ backgroundImage: 'radial-gradient(circle, #aaa 1px, transparent 1px)', backgroundSize: `${32 * canvas.scale}px ${32 * canvas.scale}px`, backgroundPosition: `${canvas.pan.x}px ${canvas.pan.y}px` }} />

          {/* Welcome Screen Component */}
          <WelcomeScreen visible={nodes.length === 0} />

          {/* 加载工作流时的 loading 遮罩 */}
          {isLoadingWorkflow && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={36} className="animate-spin text-white/70" />
                <span className="text-sm text-white/60">加载工作流中...</span>
              </div>
            </div>
          )}

          {/* Canvas Logo - Fixed at top-left, hidden when showing welcome screen */}
          {nodes.length > 0 && (
            <div className="absolute top-4 left-4 z-40 pointer-events-none select-none">
              <img
                src="/logo.png"
                alt="AIYOU Logo"
                className="h-16 md:h-20 object-contain opacity-80 hover:opacity-100 transition-opacity"
              />
            </div>
          )}

          <input type="file" ref={replaceVideoInputRef} className="hidden" accept="video/*" onChange={(e) => handleReplaceFile(e, 'video')} />
          <input type="file" ref={replaceImageInputRef} className="hidden" accept="image/*" onChange={(e) => handleReplaceFile(e, 'image')} />

          <div ref={canvas.canvasTransformRef} style={{ transform: `translate(${canvas.pan.x}px, ${canvas.pan.y}px) scale(${canvas.scale})`, width: '100%', height: '100%', transformOrigin: '0 0' }} className="w-full h-full">
              {/* Groups Layer */}
              {groups.map(g => (
                  <div 
                      key={g.id} className={`absolute rounded-[32px] border transition-all ${(draggingGroup?.id === g.id || draggingNodeParentGroupId === g.id) ? 'duration-0' : 'duration-300'} ${selectedGroupId === g.id ? 'border-cyan-500/30 bg-cyan-500/5' : 'border-white/10 bg-white/5'}`} style={{ left: g.x, top: g.y, width: g.width, height: g.height }} 
                      onMouseDown={(e) => { 
                          e.stopPropagation(); setSelectedGroupId(g.id); 
                          const childNodes = nodes.filter(n => { const b = getNodeBounds(n); const cx = b.x + b.width/2; const cy = b.y + b.height/2; return cx>g.x && cx<g.x+g.width && cy>g.y && cy<g.y+g.height; }).map(n=>({id:n.id, startX:n.x, startY:n.y}));
                          dragGroupRef.current = { id: g.id, startX: g.x, startY: g.y, mouseStartX: e.clientX, mouseStartY: e.clientY, childNodes };
                          setActiveGroupNodeIds(childNodes.map(c => c.id)); setDraggingGroup({ id: g.id }); 
                      }} 
                      onContextMenu={e => { e.stopPropagation(); setContextMenu({visible:true, x:e.clientX, y:e.clientY, id:g.id}); setContextMenuTarget({type:'group', id:g.id}); }}
                  >
                      <div className="absolute -top-8 left-4 text-xs font-bold text-white/40 uppercase tracking-widest">{g.title}</div>
                  </div>
              ))}

              {/* Connections Layer */}
              <svg className="absolute top-0 left-0 w-full h-full overflow-visible pointer-events-none z-0" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}>
                  <MemoizedConnectionLayer
                      nodes={nodes}
                      connections={connections}
                      scale={canvas.scale}
                      pan={canvas.pan}
                      connectionStart={connectionStart}
                      mousePos={canvas.mousePos}
                      onConnectionClick={(conn, e) => {
                          e.stopPropagation();
                          setContextMenu({ visible: true, x: e.clientX, y: e.clientY, id: `${conn.from}-${conn.to}` });
                          setContextMenuTarget({ type: 'connection', from: conn.from, to: conn.to });
                      }}
                      getNodeHeight={getApproxNodeHeight}
                  />
              </svg>

              {/* 画布虚拟化：只渲染视口内可见的节点 */}
              {visibleNodes.map(node => {
                  const inputAssets = getNodeInputAssets(node.id, node.inputs);
                  return (
                  <Node
                      key={node.id}
                      node={node}
                      // 性能优化：使用nodeQuery而不是传递整个nodes数组
                      nodeQuery={nodeQuery.current}
                      characterLibrary={assetHistory.filter(a => a.type === 'character').map(a => a.data)}
                      onUpdate={handleNodeUpdate}
                      onAction={handleNodeAction}
                      onDelete={handleNodeDelete}
                      onExpand={handleNodeExpand}
                      onCrop={handleNodeCrop}
                      onNodeMouseDown={handleNodeMouseDown}
                      onPortMouseDown={handlePortMouseDown}
                      onPortMouseUp={handlePortMouseUp}
                      onNodeContextMenu={handleNodeContextMenu}
                      onResizeMouseDown={handleResizeMouseDown}
                      onCharacterAction={handleCharacterAction}
                      onViewCharacter={(char) => setViewingCharacter({ character: char, nodeId: node.id })}
                      onOpenVideoEditor={handleOpenVideoEditor}
                      isSelected={selectedNodeIds.includes(node.id)}
                      inputAssets={inputAssets}
                      onInputReorder={handleInputReorder}
                      isDragging={draggingNodeId === node.id} isResizing={resizingNodeId === node.id} isConnecting={!!connectionStart} isGroupDragging={activeGroupNodeIds.includes(node.id)}
                  />
                  );
              })}

              {selectionRect && <div className="absolute border border-cyan-500/40 bg-cyan-500/10 rounded-lg pointer-events-none" style={{ left: (Math.min(selectionRect.startX, selectionRect.currentX) - canvas.pan.x) / canvas.scale, top: (Math.min(selectionRect.startY, selectionRect.currentY) - canvas.pan.y) / canvas.scale, width: Math.abs(selectionRect.currentX - selectionRect.startX) / canvas.scale, height: Math.abs(selectionRect.currentY - selectionRect.startY) / canvas.scale }} />}
          </div>

          {/* Context Menu Component */}
          <CanvasContextMenu
              visible={contextMenu?.visible || false}
              x={contextMenu?.x || 0}
              y={contextMenu?.y || 0}
              target={contextMenuTarget}
              nodeData={nodes.find(n => n.id === contextMenu?.id)?.data}
              nodeType={nodes.find(n => n.id === contextMenu?.id)?.type}
              selectedNodeIds={selectedNodeIds}
              nodeTypes={[
                  NodeType.SCRIPT_PLANNER,
                  NodeType.SCRIPT_EPISODE,
                  NodeType.CHARACTER_NODE,
                  NodeType.STYLE_PRESET,
                  NodeType.STORYBOARD_GENERATOR,
                  NodeType.STORYBOARD_IMAGE,
                  NodeType.STORYBOARD_SPLITTER,
                  NodeType.SORA_VIDEO_GENERATOR,
                  NodeType.DRAMA_ANALYZER
              ]}
              onClose={() => setContextMenu(null)}
              onAction={(action, data) => {
                  switch (action) {
                      case 'copy':
                          const targetNode = nodes.find(n => n.id === data);
                          if (targetNode) setClipboard(structuredClone(targetNode));
                          break;

                      case 'replace':
                          replacementTargetRef.current = data;
                          const node = nodes.find(n => n.id === data);
                          if (node) {
                              const isVideo = node.type === NodeType.VIDEO_GENERATOR || node.type === NodeType.VIDEO_ANALYZER;
                              if (isVideo) replaceVideoInputRef.current?.click();
                              else replaceImageInputRef.current?.click();
                          }
                          break;

                      case 'delete':
                          deleteNodes([data]);
                          break;

                      case 'deleteMultiple':
                          // 删除所有选中的节点
                          if (Array.isArray(data) && data.length > 0) {
                              deleteNodes(data);
                              // 清除选中状态
                              setSelectedNodeIds([]);
                          }
                          break;

                      case 'createGroupFromSelection':
                          // 从选中的节点创建分组
                          if (Array.isArray(data) && data.length > 0) {
                              const selectedNodes = nodes.filter(n => data.includes(n.id));
                              if (selectedNodes.length > 0) {
                                  saveHistory();

                                  // 计算分组边界
                                  const fMinX = Math.min(...selectedNodes.map(n => n.x));
                                  const fMinY = Math.min(...selectedNodes.map(n => n.y));
                                  const fMaxX = Math.max(...selectedNodes.map(n => n.x + (n.width || 420)));
                                  const fMaxY = Math.max(...selectedNodes.map(n => n.y + 320));

                                  // 创建新分组
                                  const newGroup = {
                                      id: `g-${Date.now()}`,
                                      title: '新建分组',
                                      x: fMinX - 32,
                                      y: fMinY - 32,
                                      width: (fMaxX - fMinX) + 64,
                                      height: (fMaxY - fMinY) + 64
                                  };

                                  setGroups(prev => [...prev, newGroup]);

                                  // 清除选中状态
                                  setSelectedNodeIds([]);
                              }
                          }
                          break;

                      case 'downloadImage':
                          const downloadNode = nodes.find(n => n.id === data);

                          if (!downloadNode) {
                              console.error('[下载分镜图] 未找到节点');
                              break;
                          }

                          if (downloadNode.data.storyboardGridImages?.length > 0) {
                              // 下载所有分镜图页面

                              downloadNode.data.storyboardGridImages.forEach((imageUrl: string, index: number) => {
                                  setTimeout(() => {
                                      try {
                                          const a = document.createElement('a');
                                          a.href = imageUrl;
                                          a.download = `storyboard-page-${index + 1}-${Date.now()}.png`;
                                          a.target = '_blank'; // 在新标签页打开，避免浏览器阻止
                                          document.body.appendChild(a);
                                          a.click();
                                          setTimeout(() => document.body.removeChild(a), 100);
                                      } catch (err) {
                                          console.error(`[下载分镜图] 第 ${index + 1} 张下载失败:`, err);
                                      }
                                  }, index * 800); // 增加间隔到800ms
                              });
                          } else if (downloadNode.data.storyboardGridImage) {
                              // 下载单张分镜图
                              const a = document.createElement('a');
                              a.href = downloadNode.data.storyboardGridImage;
                              a.download = `storyboard-${Date.now()}.png`;
                              a.target = '_blank';
                              document.body.appendChild(a);
                              a.click();
                              setTimeout(() => document.body.removeChild(a), 100);
                          } else {
                              console.warn('[下载分镜图] 节点中没有找到图片数据');
                          }
                          break;

                      case 'createNode':
                          addNode(data.type, (data.x - canvas.pan.x) / canvas.scale, (data.y - canvas.pan.y) / canvas.scale);
                          break;

                      case 'saveGroup':
                          saveGroupAsWorkflow(data);
                          break;

                      case 'deleteGroup':
                          setGroups(p => p.filter(g => g.id !== data));
                          break;

                      case 'deleteConnection':
                          setConnections(prev => prev.filter(c => c.from !== data.from || c.to !== data.to));
                          setNodes(prev => prev.map(n =>
                              n.id === data.to ? { ...n, inputs: n.inputs.filter(i => i !== data.from) } : n
                          ));
                          break;

                      default:
                          console.warn('Unknown action:', action);
                  }
              }}
              getNodeIcon={getNodeIcon}
              getNodeName={getNodeNameCN}
          />
          
          {croppingNodeId && imageToCrop && (
            <Suspense fallback={<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"><Loader2 size={48} className="animate-spin text-cyan-400" /></div>}>
              <ImageCropper imageSrc={imageToCrop} onCancel={() => {setCroppingNodeId(null); setImageToCrop(null);}} onConfirm={async (b) => {const url = await uploadMediaToServer(b, { nodeId: croppingNodeId, type: 'image' }); handleNodeUpdate(croppingNodeId, {croppedFrame: url}); setCroppingNodeId(null); setImageToCrop(null);}} />
            </Suspense>
          )}
          <ExpandedView media={expandedMedia} onClose={() => setExpandedMedia(null)} />
          {isSketchEditorOpen && (
            <Suspense fallback={<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"><Loader2 size={48} className="animate-spin text-cyan-400" /></div>}>
              <SketchEditor onClose={() => setIsSketchEditorOpen(false)} onGenerate={handleSketchResult} />
            </Suspense>
          )}
          <SmartSequenceDock 
             isOpen={isMultiFrameOpen} 
             onClose={() => setIsMultiFrameOpen(false)} 
             onGenerate={handleMultiFrameGenerate}
             onConnectStart={(e, type) => { e.preventDefault(); e.stopPropagation(); setConnectionStart({ id: 'smart-sequence-dock', x: e.clientX, y: e.clientY }); }}
          />
          <Suspense fallback={<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"><Loader2 size={48} className="animate-spin text-cyan-400" /></div>}>
            <SonicStudio
              isOpen={isSonicStudioOpen}
              onClose={() => setIsSonicStudioOpen(false)}
              history={assetHistory.filter(a => a.type === 'audio')}
              onGenerate={(src, prompt) => handleAssetGenerated('audio', src, prompt)}
            />
          </Suspense>
          <Suspense fallback={<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"><Loader2 size={48} className="animate-spin text-cyan-400" /></div>}>
            <CharacterLibrary
              isOpen={isCharacterLibraryOpen}
              onClose={() => setIsCharacterLibraryOpen(false)}
              characters={assetHistory.filter(a => a.type === 'character').map(a => a.data)}
              onDelete={(id) => {
                  // Find matching asset ID (which is the char.id)
                  setAssetHistory(prev => prev.filter(a => a.id !== id));
              }}
            />
          </Suspense>
          <Suspense fallback={<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"><Loader2 size={48} className="animate-spin text-cyan-400" /></div>}>
            <CharacterDetailModal
              character={viewingCharacter?.character || null}
              nodeId={viewingCharacter?.nodeId}
            allNodes={nodes}
            onClose={() => setViewingCharacter(null)}
            onGenerateExpression={(nodeId, charName) => handleCharacterAction(nodeId, 'GENERATE_EXPRESSION', charName)}
            onGenerateThreeView={(nodeId, charName) => handleCharacterAction(nodeId, 'GENERATE_THREE_VIEW', charName)}
          />
          </Suspense>
          <SettingsPanel
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
          />
          <ApiKeyPrompt
            isOpen={isApiKeyPromptOpen}
            onClose={() => setIsApiKeyPromptOpen(false)}
            onSave={handleApiKeySave}
          />
          <DebugPanel
            isOpen={isDebugOpen}
            onClose={() => setIsDebugOpen(false)}
          />

          {/* 视频编辑器 */}
          <Suspense fallback={<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"><Loader2 size={48} className="animate-spin text-cyan-400" /></div>}>
            <VideoEditor
              isOpen={isVideoEditorOpen}
              onClose={() => setIsVideoEditorOpen(false)}
              initialVideos={videoEditorSources}
              onExport={(outputUrl) => {
                // TODO: 将导出的视频保存到节点或下载
              }}
            />
          </Suspense>

          {/* 模型降级通知 */}
          <ModelFallbackNotification />
          <NotificationToast />

          <SidebarDock
              onAddNode={addNode}
              onUndo={undo}
              isChatOpen={isChatOpen}
              onToggleChat={() => setIsChatOpen(!isChatOpen)}
              isMultiFrameOpen={isMultiFrameOpen}
              onToggleMultiFrame={() => setIsMultiFrameOpen(!isMultiFrameOpen)}
              isSonicStudioOpen={isSonicStudioOpen}
              onToggleSonicStudio={() => setIsSonicStudioOpen(!isSonicStudioOpen)}
              isCharacterLibraryOpen={isCharacterLibraryOpen}
              onToggleCharacterLibrary={() => setIsCharacterLibraryOpen(!isCharacterLibraryOpen)}
              isDebugOpen={isDebugOpen}
              onToggleDebug={() => setIsDebugOpen(!isDebugOpen)}
              isPromptManagerOpen={isPromptManagerOpen}
              onTogglePromptManager={() => setIsPromptManagerOpen(!isPromptManagerOpen)}
              assetHistory={assetHistory}
              onHistoryItemClick={(item) => { const type = item.type.includes('image') ? NodeType.IMAGE_GENERATOR : NodeType.VIDEO_GENERATOR; const data = item.type === 'image' ? { image: item.src } : { videoUri: item.src }; addNode(type, undefined, undefined, data); }}
              onDeleteAsset={(id) => setAssetHistory(prev => prev.filter(a => a.id !== id))}
              workflows={workflows}
              selectedWorkflowId={selectedWorkflowId}
              onSelectWorkflow={loadWorkflow}
              onSaveWorkflow={saveCurrentAsWorkflow}
              onNewWorkflow={createNewWorkflow}
              onDeleteWorkflow={deleteWorkflow}
              onRenameWorkflow={renameWorkflow}
              onOpenSettings={() => setIsSettingsOpen(true)}
          />


          <WorkflowPromptManager
            isOpen={isPromptManagerOpen}
            nodes={nodes}
            connections={connections}
            onClose={() => setIsPromptManagerOpen(false)}
            onApplyPrompt={applyPromptToNode}
            onApplyBatch={applyPromptBatch}
            onPersist={saveCurrentAsWorkflow}
          />

          <AssistantPanel isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />

          {/* Language Toggle Button */}
          <div className="absolute top-8 right-8 z-50 animate-in fade-in slide-in-from-top-4 duration-700 flex flex-col gap-2 items-end">
              {storageReconnectNeeded && (
                  <button
                      onClick={async () => {
                          try {
                              const { getFileStorageService } = await import('./services/storage');
                              const service = getFileStorageService();
                              await service.selectRootDirectory();
                              setStorageReconnectNeeded(false);
                              alert('✅ 已成功连接工作文件夹！');
                          } catch (error: any) {
                              console.error('[App] 重连失败:', error);
                              alert('❌ 连接失败: ' + error.message);
                          }
                      }}
                      className="flex items-center gap-2 px-4 py-2 bg-orange-500/20 backdrop-blur-2xl border border-orange-500/30 rounded-full shadow-2xl text-orange-300 hover:text-orange-200 hover:border-orange-500/50 transition-all hover:scale-105 animate-pulse"
                      title="点击重新连接本地存储文件夹"
                  >
                      <HardDrive size={16} />
                      <span className="text-xs font-medium">重连存储</span>
                  </button>
              )}
              {/* 保存按钮 + 翻译按钮 - 只在进入画布后显示 */}
              {nodes.length > 0 && (
                  <>
                      <button
                          onClick={saveCurrentAsWorkflow}
                          className="flex items-center gap-2 px-4 py-2 bg-[#1c1c1e]/80 backdrop-blur-2xl border border-white/10 rounded-full shadow-2xl text-slate-300 hover:text-white hover:border-white/20 transition-all hover:scale-105"
                          title="保存当前工作流"
                      >
                          <Save size={16} />
                          <span className="text-xs font-medium">保存</span>
                      </button>
                      <button
                          onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
                          className="flex items-center gap-2 px-4 py-2 bg-[#1c1c1e]/80 backdrop-blur-2xl border border-white/10 rounded-full shadow-2xl text-slate-300 hover:text-white hover:border-white/20 transition-all hover:scale-105"
                          title={t.settings.language}
                      >
                          <Languages size={16} />
                          <span className="text-xs font-medium">{language === 'zh' ? t.settings.english : t.settings.chinese}</span>
                      </button>
                  </>
              )}
          </div>

          {/* 放大缩小按钮 - 只在进入画布后显示 */}
          {nodes.length > 0 && (
              <div className="absolute bottom-8 right-8 flex items-center gap-3 px-4 py-2 bg-[#1c1c1e]/80 backdrop-blur-2xl border border-white/10 rounded-full shadow-2xl z-50 animate-in fade-in slide-in-from-bottom-4 duration-700">
                  <button onClick={() => canvas.setScale(s => Math.max(0.2, s - 0.1))} className="p-1.5 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-white/10"><Minus size={14} strokeWidth={3} /></button>
                  <div className="flex items-center gap-2 min-w-[100px]">
                       <input type="range" min="0.2" max="3" step="0.1" value={canvas.scale} onChange={(e) => canvas.setScale(parseFloat(e.target.value))} className="w-24 h-1 bg-white/20 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-lg hover:[&::-webkit-slider-thumb]:scale-125 transition-all" />
                       <span className="text-[10px] font-bold text-slate-400 w-8 text-right tabular-nums cursor-pointer hover:text-white" onClick={() => canvas.setScale(1)} title="Reset Zoom">{Math.round(canvas.scale * 100)}%</span>
                  </div>
                  <button onClick={() => canvas.setScale(s => Math.min(3, s + 0.1))} className="p-1.5 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-white/10"><Plus size={14} strokeWidth={3} /></button>
                  <button onClick={handleFitView} className="p-1.5 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-white/10 ml-2 border-l border-white/10 pl-3" title="适配视图">
                      <Scan size={14} strokeWidth={3} />
                  </button>
              </div>
          )}
      </div>
    </div>
  );
};
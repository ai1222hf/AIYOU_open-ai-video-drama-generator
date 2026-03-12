/**
 * AIYOU 漫剧生成平台 - 节点组件（主入口）
 *
 * 从原始 5841 行 Node.tsx 拆分而来。
 * 常量、类型、辅助组件已提取到同目录下的独立文件。
 *
 * @developer 光波 (a@ggbo.com)
 * @copyright Copyright (c) 2025 光波. All rights reserved.
 */

import { AppNode, NodeStatus, NodeType, StoryboardShot, CharacterProfile } from '../../types';
import { RefreshCw, Play, Image as ImageIcon, Video as VideoIcon, Type, AlertCircle, CheckCircle, Plus, Maximize2, Download, MoreHorizontal, Wand2, Scaling, FileSearch, Edit, Loader2, Layers, Trash2, X, Upload, Scissors, Film, MousePointerClick, Crop as CropIcon, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, GripHorizontal, Link, Copy, Monitor, Music, Pause, Volume2, Mic2, BookOpen, ScrollText, Clapperboard, LayoutGrid, Box, User, Users, Save, RotateCcw, Eye, List, Sparkles, ZoomIn, ZoomOut, Minus, Circle, Square, Maximize, Move, RotateCw, TrendingUp, TrendingDown, ArrowRight, ArrowUp, ArrowDown, ArrowUpRight, ArrowDownRight, Palette, Grid, Grid3X3, MoveHorizontal, ArrowUpDown, Database, ShieldAlert, ExternalLink, Package } from 'lucide-react';
import { VideoModeSelector, SceneDirectorOverlay } from '../VideoNodeModules';
import { PromptEditor } from '../PromptEditor';
import { StoryboardVideoNode, StoryboardVideoChildNode } from '../StoryboardVideoNode';
import React, { memo, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { IMAGE_MODELS, TEXT_MODELS, VIDEO_MODELS, AUDIO_MODELS } from '../../services/modelConfig';
import { promptManager } from '../../services/promptManager';
import { getNodeNameCN, getNodeInfo } from '../../utils/nodeHelpers';
import { uploadMediaToServer } from '../../services/mediaStorageService';
import { getAllModelsConfig, getAllSubModelNames } from '../../services/modelConfigLoader';

// Extracted modules
import {
  IMAGE_ASPECT_RATIOS, VIDEO_ASPECT_RATIOS, IMAGE_RESOLUTIONS, VIDEO_RESOLUTIONS,
  SHOT_TYPES, CAMERA_ANGLES, CAMERA_MOVEMENTS,
  IMAGE_COUNTS, VIDEO_COUNTS, GLASS_PANEL,
  DEFAULT_NODE_WIDTH, DEFAULT_FIXED_HEIGHT, AUDIO_NODE_HEIGHT,
  STORYBOARD_NODE_HEIGHT, CHARACTER_NODE_HEIGHT,
  STYLE_BLUR_ON, STYLE_BLUR_OFF,
  STYLE_MAX_HEIGHT_180, STYLE_MAX_HEIGHT_200, STYLE_MIN_HEIGHT_80,
  STYLE_HEIGHT_60, STYLE_HEIGHT_80,
  SHORT_DRAMA_GENRES, SHORT_DRAMA_SETTINGS,
} from './constants';
import { NodeProps, InputAsset, NodeContentContext } from './types';
import { SecureVideo, safePlay, safePause, AudioVisualizer, EpisodeViewer, InputThumbnails } from './helpers';
import { MediaContent } from './MediaContent';
import { BottomPanel } from './BottomPanel';

/**
 * 节点信息提示组件 — 叹号图标，hover 显示节点介绍和连接范围
 */
const NodeInfoTooltip = ({ type }: { type: NodeType }) => {
  const [show, setShow] = useState(false);
  const info = getNodeInfo(type);

  return (
    <div
      className="relative ml-0.5"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <AlertCircle size={11} className="text-slate-500 hover:text-slate-300 cursor-help transition-colors" />
      {show && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-6 z-[9999] w-56 p-2.5 bg-[#1c1c1e]/95 backdrop-blur-xl border border-white/15 rounded-lg shadow-2xl pointer-events-none">
          <p className="text-[10px] text-slate-300 leading-relaxed mb-1.5">{info.description}</p>
          <div className="border-t border-white/10 pt-1.5 space-y-1">
            <p className="text-[9px] text-slate-500"><span className="text-cyan-400/80">接入 ←</span> {info.inputs}</p>
            <p className="text-[9px] text-slate-500"><span className="text-amber-400/80">接出 →</span> {info.outputs}</p>
          </div>
        </div>
      )}
    </div>
  );
};

// 性能优化：将关键数据字段列表提升为模块级常量，避免每次比较时重新创建数组
const CRITICAL_DATA_KEYS: readonly string[] = [
    'prompt', 'model', 'aspectRatio', 'resolution', 'count',
    'image', 'videoUri', 'croppedFrame', 'analysis',
    'scriptOutline', 'scriptGenre', 'scriptSetting', 'scriptVisualStyle',
    'scriptEpisodes', 'scriptDuration',
    'generatedEpisodes',
    'episodeSplitCount', 'episodeModificationSuggestion', 'selectedChapter',
    'storyboardCount', 'storyboardDuration', 'storyboardStyle', 'storyboardGridType', 'storyboardShots',
    'storyboardGridImage', 'storyboardGridImages', 'storyboardPanelOrientation', 'storyboardCurrentPage', 'storyboardTotalPages',
    'extractedCharacterNames', 'characterConfigs', 'generatedCharacters',
    'stylePrompt', 'negativePrompt', 'visualStyle',
    'error', 'progress', 'duration', 'quality', 'isCompliant',
    'isExpanded', 'videoMode', 'shotType', 'cameraAngle', 'cameraMovement',
    'selectedFields', 'dramaName', 'taskGroups',
    'modelConfig',
    'selectedPlatform', 'selectedModel', 'subModel',
    'availableShots', 'selectedShotIds', 'selectedSourceNodes', 'splitShots', 'isSplitting', 'generatedPrompt', 'fusedImage',
    'isLoading', 'isLoadingFusion', 'promptModified', 'status', 'statusMessage',
    'audioUri', 'images', 'videoUris', 'isCached', 'cacheLocation',
    'episodeStoryboard', 'generationMode',
    'dramaIntroduction', 'worldview',
] as const;

const arePropsEqual = (prev: NodeProps, next: NodeProps): boolean => {
    // 快速路径：如果node引用完全相同，只需检查少量标量props
    if (prev.node === next.node &&
        prev.isSelected === next.isSelected &&
        prev.isConnecting === next.isConnecting &&
        prev.isDragging === next.isDragging &&
        prev.isResizing === next.isResizing &&
        prev.isGroupDragging === next.isGroupDragging &&
        prev.inputAssets === next.inputAssets &&
        prev.characterLibrary === next.characterLibrary) {
        return true;
    }

    // 检查交互状态变化（这些状态变化时必须重新渲染）
    if (prev.isDragging !== next.isDragging ||
        prev.isResizing !== next.isResizing ||
        prev.isSelected !== next.isSelected ||
        prev.isGroupDragging !== next.isGroupDragging ||
        prev.isConnecting !== next.isConnecting) {
        return false;
    }

    const prevNode = prev.node;
    const nextNode = next.node;

    // 检查基本属性
    if (prevNode.id !== nextNode.id ||
        prevNode.type !== nextNode.type ||
        prevNode.x !== nextNode.x ||
        prevNode.y !== nextNode.y ||
        prevNode.width !== nextNode.width ||
        prevNode.height !== nextNode.height ||
        prevNode.status !== nextNode.status ||
        prevNode.title !== nextNode.title) {
        return false;
    }

    // 检查node.data的关键属性（使用模块级常量避免每次创建数组）
    const prevData = prevNode.data;
    const nextData = nextNode.data;

    for (let i = 0; i < CRITICAL_DATA_KEYS.length; i++) {
        if (prevData[CRITICAL_DATA_KEYS[i]] !== nextData[CRITICAL_DATA_KEYS[i]]) {
            return false;
        }
    }

    // 检查inputs数组
    const prevInputs = prevNode.inputs;
    const nextInputs = nextNode.inputs;
    if (prevInputs.length !== nextInputs.length) {
        return false;
    }
    for (let i = 0; i < prevInputs.length; i++) {
        if (prevInputs[i] !== nextInputs[i]) {
            return false;
        }
    }

    // 检查inputAssets（输入的图片/视频资源）
    const prevInputAssets = prev.inputAssets || [];
    const nextInputAssets = next.inputAssets || [];
    if (prevInputAssets.length !== nextInputAssets.length) {
        return false;
    }
    for (let i = 0; i < prevInputAssets.length; i++) {
        const pa = prevInputAssets[i];
        const na = nextInputAssets[i];
        if (pa.id !== na.id || pa.src !== na.src || pa.type !== na.type) {
            return false;
        }
    }

    // 所有关键属性都相同，不需要重新渲染
    return true;
};

const NodeComponent: React.FC<NodeProps> = ({
  node, onUpdate, onAction, onDelete, onExpand, onCrop, onNodeMouseDown, onPortMouseDown, onPortMouseUp, onNodeContextMenu, onMediaContextMenu, onResizeMouseDown, onInputReorder, onCharacterAction, onViewCharacter, onOpenVideoEditor, inputAssets, isDragging, isGroupDragging, isSelected, isResizing, isConnecting, nodeQuery, characterLibrary
}) => {
  const isWorking = node.status === NodeStatus.WORKING;
  const [isActionProcessing, setIsActionProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const isActionDisabled = isWorking || isActionProcessing;

  // 动态加载的模型配置（用于 STORYBOARD_VIDEO_GENERATOR）
  const [dynamicSubModels, setDynamicSubModels] = useState<Record<string, Record<string, string[]>>>({});
  const [dynamicSubModelNames, setDynamicSubModelNames] = useState<Record<string, string>>({});
  const [configLoaded, setConfigLoaded] = useState(false);

  const mediaRef = useRef<HTMLImageElement | HTMLVideoElement | HTMLAudioElement | null>(null);
  const isHoveringRef = useRef(false);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);  // 延迟关闭定时器
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
  const [isLoadingVideo, setIsLoadingVideo] = useState(false); 
  const [showImageGrid, setShowImageGrid] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(node.title);
  const [isHovered, setIsHovered] = useState(false); 
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const generationMode = node.data.generationMode || 'CONTINUE';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [localPrompt, setLocalPrompt] = useState(node.data.prompt || '');
  const [inputHeight, setInputHeight] = useState(48); 
  const isResizingInput = useRef(false);
  const inputStartDragY = useRef(0);
  const inputStartHeight = useRef(0);
  const [availableChapters, setAvailableChapters] = useState<string[]>([]);
  const [viewingOutline, setViewingOutline] = useState(false);
  const actionProcessingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 🚀 Sora2配置本地状态 - 用于立即响应UI更新
  const [localSoraConfigs, setLocalSoraConfigs] = useState<Record<string, { aspect_ratio: string; duration: string; hd: boolean }>>({});

  // 🎬 VIDEO_EDITOR 状态
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportSettings, setExportSettings] = useState({
    name: `视频作品_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}_${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`,
    resolution: '1080p',
    format: 'mp4'
  });

  // 同步 node.data.taskGroups 到本地状态
  useEffect(() => {
    if (node.type === NodeType.SORA_VIDEO_GENERATOR) {
      const configs: Record<string, any> = {};
      (node.data.taskGroups || []).forEach((tg: any) => {
        if (tg.id) {  // 🔥 安全检查：确保 tg.id 存在
          configs[tg.id] = {
            aspect_ratio: tg.sora2Config?.aspect_ratio || '16:9',
            duration: tg.sora2Config?.duration || '10',
            hd: tg.sora2Config?.hd ?? true
          };
        }
      });
      setLocalSoraConfigs(configs);
    }
  }, [node.id, node.data.taskGroups]);

  useEffect(() => { setLocalPrompt(node.data.prompt || ''); }, [node.data.prompt]);
  const commitPrompt = () => { if (localPrompt !== (node.data.prompt || '')) onUpdate(node.id, { prompt: localPrompt }); };

  // 清理定时器
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  // 加载后台模型配置（用于 STORYBOARD_VIDEO_GENERATOR）
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const [subModels, subModelNames] = await Promise.all([
          getAllModelsConfig(),
          getAllSubModelNames()
        ]);
        setDynamicSubModels(subModels);
        setDynamicSubModelNames(subModelNames);
        setConfigLoaded(true);
      } catch (error) {
        console.error('[Node] ❌ Failed to load model config:', error);
        setConfigLoaded(true); // 失败也标记为已加载，会回退到默认值
      }
    };

    // 只在 STORYBOARD_VIDEO_GENERATOR 节点加载配置
    if (node.type === NodeType.STORYBOARD_VIDEO_GENERATOR) {
      loadConfig();
    }
  }, [node.type]);

  // 🔥 关键修复：从 node.data 恢复实体数据到 manager（刷新后需要）
  useEffect(() => {
    if (![NodeType.CHARACTER_NODE, NodeType.SCENE_NODE, NodeType.ITEM_NODE].includes(node.type)) return;

    const restoreManagerFromNodeData = async () => {
      try {
        const { characterGenerationManager } = await import('../../services/characterGenerationManager');
        const generated = node.data.generatedCharacters || [];

        // 遍历所有已生成的角色，恢复到 manager
        for (const char of generated) {
          if (char.basicStats || char.profession || char.expressionSheet || char.threeViewSheet) {
            const state = characterGenerationManager.getCharacterState(node.id, char.name);

            // 如果 manager 中没有这个角色，或者数据不完整，则恢复
            if (!state || !state.profile) {
              characterGenerationManager.restoreCharacter(node.id, char.name, {
                profile: char,
                expressionSheet: char.expressionSheet,
                threeViewSheet: char.threeViewSheet,
                expressionPromptZh: char.expressionPromptZh,
                expressionPromptEn: char.expressionPromptEn,
                threeViewPromptZh: char.threeViewPromptZh,
                threeViewPromptEn: char.threeViewPromptEn
              });

            }
          }
        }
      } catch (error) {
        console.error('[Node] Failed to restore characters to manager:', error);
      }
    };

    restoreManagerFromNodeData();
  }, [node.id, node.data.generatedCharacters, node.type]);


  // 防重复点击的 Action 处理函数
  const handleActionClick = () => {
    // 如果正在处理中，直接返回
    if (isActionProcessing) {
      return;
    }

    // 标记为处理中
    setIsActionProcessing(true);

    // 执行操作
    commitPrompt();
    onAction(node.id, localPrompt);

    // 清除之前的定时器
    if (actionProcessingTimerRef.current) {
      clearTimeout(actionProcessingTimerRef.current);
    }

    // 1秒后解除阻止
    actionProcessingTimerRef.current = setTimeout(() => {
      setIsActionProcessing(false);
    }, 1000);
  };

  const handleCmdEnter = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      // 使用相同的防重复点击逻辑
      if (isActionProcessing) {
        return;
      }
      setIsActionProcessing(true);
      commitPrompt();
      onAction(node.id, localPrompt);
      if (actionProcessingTimerRef.current) {
        clearTimeout(actionProcessingTimerRef.current);
      }
      actionProcessingTimerRef.current = setTimeout(() => {
        setIsActionProcessing(false);
      }, 1000);
    }
  };
  
  const handleInputResizeStart = (e: React.MouseEvent) => {
      e.stopPropagation(); e.preventDefault();
      isResizingInput.current = true; inputStartDragY.current = e.clientY; inputStartHeight.current = inputHeight;
      const handleGlobalMouseMove = (e: MouseEvent) => { 
          if (!isResizingInput.current) return; 
          setInputHeight(Math.max(48, Math.min(inputStartHeight.current + (e.clientY - inputStartDragY.current), 300))); 
      };
      const handleGlobalMouseUp = () => { isResizingInput.current = false; window.removeEventListener('mousemove', handleGlobalMouseMove); window.removeEventListener('mouseup', handleGlobalMouseUp); };
      window.addEventListener('mousemove', handleGlobalMouseMove); window.addEventListener('mouseup', handleGlobalMouseUp);
  };

  // Function to refresh chapters from planner node
  const handleRefreshChapters = useCallback(() => {
      if (node.type === NodeType.SCRIPT_EPISODE && nodeQuery) {
          const plannerNode = nodeQuery.getFirstUpstreamNode(node.id, NodeType.SCRIPT_PLANNER);
          if (plannerNode && plannerNode.data.scriptOutline) {
              // 匹配格式：*   **## 第一章：都市异象 (Episodes 1-2)** - 描述
              const regex1 = /##\s+(第[一二三四五六七八九十\d]+章[：:][^\(\*]+|最终章[：:][^\(\*]+)/gm;
              const matches = [];
              let match;
              while ((match = regex1.exec(plannerNode.data.scriptOutline)) !== null) {
                  matches.push(match[1].trim());
              }
              if (matches.length > 0) {
                  setAvailableChapters(matches);
                  // Auto-select first chapter if none selected
                  if (!node.data.selectedChapter) {
                      onUpdate(node.id, { selectedChapter: matches[0] });
                  }
              }
          } else {
          }
      }
  }, [node.type, node.inputs, node.id, node.data.selectedChapter, nodeQuery, onUpdate]);

  useEffect(() => {
      handleRefreshChapters();
  }, [handleRefreshChapters]);

  React.useEffect(() => {
      if (videoBlobUrl) { URL.revokeObjectURL(videoBlobUrl); setVideoBlobUrl(null); }
      // 支持videoUri和videoUrl两种字段名
      const videoSource = node.data.videoUri || node.data.videoUrl;

      if ((node.type === NodeType.VIDEO_GENERATOR || node.type === NodeType.VIDEO_ANALYZER || node.type === NodeType.SORA_VIDEO_CHILD) && videoSource) {
          // 如果是base64，直接使用
          if (videoSource.startsWith('data:')) {
              setVideoBlobUrl(videoSource);
              return;
          }

          // 对于 Sora 视频，直接使用 URL，不需要额外处理
          if (node.type === NodeType.SORA_VIDEO_CHILD) {
              setVideoBlobUrl(videoSource);
              return;
          }

          // ✅ 优先从本地存储加载视频
          const loadFromLocalFirst = async () => {
              try {
                  // 动态导入存储服务
                  const { getFileStorageService } = await import('../../services/storage/index');
                  const service = getFileStorageService();

                  // 检查本地存储是否启用
                  if (service.isEnabled()) {

                      // 获取该节点的所有视频文件
                      const metadataManager = (service as any).metadataManager;
                      if (metadataManager) {
                          const files = metadataManager.getFilesByNode(node.id);
                          const videoFiles = files.filter((f: any) =>
                              f.relativePath.includes('.mp4') ||
                              f.relativePath.includes('.video') ||
                              f.mimeType?.startsWith('video/')
                          );

                          if (videoFiles.length > 0) {

                              // 读取第一个视频文件
                              const dataUrl = await service.readFileAsDataUrl(videoFiles[0].relativePath);
                              setVideoBlobUrl(dataUrl);
                              setIsLoadingVideo(false);

                              return;
                          } else {
                          }
                      }
                  }
              } catch (error) {
              }

              // ❌ 本地存储中没有，使用在线URL

              // 其他视频类型，转换为 Blob URL
              let isActive = true;
              setIsLoadingVideo(true);

              const loadVideo = async () => {
                  try {
                      const response = await fetch(videoSource);
                      const blob = await response.blob();
                      if (isActive) {
                          const mp4Blob = new Blob([blob], { type: 'video/mp4' });
                          setVideoBlobUrl(URL.createObjectURL(mp4Blob));
                          setIsLoadingVideo(false);
                      }
                  } catch (err) {
                      console.error('[Node] 视频加载失败:', err);
                      if (isActive) setIsLoadingVideo(false);
                  }
              };

              loadVideo();

              // Cleanup function
              return () => {
                  isActive = false;
                  if (videoBlobUrl) URL.revokeObjectURL(videoBlobUrl);
              };
          };

          loadFromLocalFirst();
      }
  }, [node.data.videoUri, node.data.videoUrl, node.type, node.id]);

  const toggleAudio = (e: React.MouseEvent) => {
      e.stopPropagation();
      const audio = mediaRef.current as HTMLAudioElement;
      if (!audio) return;
      if (audio.paused) { audio.play(); setIsPlayingAudio(true); } else { audio.pause(); setIsPlayingAudio(false); }
  };

  useEffect(() => {
    return () => {
        if (mediaRef.current && (mediaRef.current instanceof HTMLVideoElement || mediaRef.current instanceof HTMLAudioElement)) {
            try { mediaRef.current.pause(); mediaRef.current.src = ""; mediaRef.current.load(); } catch (e) {}
        }
    }
  }, []);

  const handleMouseEnter = () => {
    // 清除延迟关闭定时器
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setIsHovered(true);
    isHoveringRef.current = true;
    if(node.data.images?.length > 1 || (node.data.videoUris && node.data.videoUris.length > 1)) setShowImageGrid(true);
    if (mediaRef.current instanceof HTMLVideoElement) safePlay(mediaRef.current);
  };

  const handleMouseLeave = () => {
    // 设置延迟关闭，给用户时间移动到操作区
    closeTimeoutRef.current = setTimeout(() => {
      setIsHovered(false);
      isHoveringRef.current = false;
      setShowImageGrid(false);
      if (mediaRef.current instanceof HTMLVideoElement) safePause(mediaRef.current);
    }, 300); // 300ms 延迟
  };
  
  const handleExpand = (e: React.MouseEvent) => { 
      e.stopPropagation(); 
      if (onExpand && mediaRef.current) { 
          const rect = mediaRef.current.getBoundingClientRect(); 
          if (node.type.includes('IMAGE') && node.data.image) {
              onExpand({ type: 'image', src: node.data.image, rect, images: node.data.images || [node.data.image], initialIndex: (node.data.images || [node.data.image]).indexOf(node.data.image) }); 
          } else if (node.type.includes('VIDEO') && node.data.videoUri) {
              const src = node.data.videoUri;
              const videos = node.data.videoUris && node.data.videoUris.length > 0 ? node.data.videoUris : [src];
              const currentIndex = node.data.videoUris ? node.data.videoUris.indexOf(node.data.videoUri) : 0;
              const safeIndex = currentIndex >= 0 ? currentIndex : 0;
              onExpand({ type: 'video', src: src, rect, images: videos, initialIndex: safeIndex }); 
          }
      }
  };
  const handleDownload = (e: React.MouseEvent) => { e.stopPropagation(); const a = document.createElement('a'); a.href = node.data.image || videoBlobUrl || node.data.audioUri || ''; a.download = `sunstudio-${Date.now()}`; document.body.appendChild(a); a.click(); document.body.removeChild(a); };

  // 防重复点击的上传处理函数
  const handleUploadVideo = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isUploading) return;

    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      const url = await uploadMediaToServer(base64, { nodeId: node.id, type: 'video' });
      onUpdate(node.id, { videoUri: url });
      setIsUploading(false);
    };
    reader.onerror = () => setIsUploading(false);
    reader.readAsDataURL(file);
  };

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isUploading) return;

    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      const url = await uploadMediaToServer(base64, { nodeId: node.id, type: 'image' });
      onUpdate(node.id, { image: url });
      setIsUploading(false);
    };
    reader.onerror = () => setIsUploading(false);
    reader.readAsDataURL(file);
  };
  
  const handleAspectRatioSelect = (newRatio: string) => {
    const [w, h] = newRatio.split(':').map(Number);
    let newSize: { width?: number, height?: number } = { height: undefined };
    if (w && h) { 
        const currentWidth = node.width || DEFAULT_NODE_WIDTH; 
        const projectedHeight = (currentWidth * h) / w; 
        if (projectedHeight > 600) newSize.width = (600 * w) / h; 
    }
    onUpdate(node.id, { aspectRatio: newRatio }, newSize);
  };
  
  const handleTitleSave = () => { setIsEditingTitle(false); if (tempTitle.trim() && tempTitle !== node.title) onUpdate(node.id, {}, undefined, tempTitle); else setTempTitle(node.title); };

  const getNodeConfig = () => {
      switch (node.type) {
        case NodeType.PROMPT_INPUT: return { icon: Type, color: 'text-amber-400', border: 'border-amber-500/30' };
        case NodeType.IMAGE_GENERATOR: return { icon: ImageIcon, color: 'text-cyan-400', border: 'border-cyan-500/30' };
        case NodeType.VIDEO_GENERATOR: return { icon: VideoIcon, color: 'text-purple-400', border: 'border-purple-500/30' };
        case NodeType.AUDIO_GENERATOR: return { icon: Mic2, color: 'text-pink-400', border: 'border-pink-500/30' };
        case NodeType.VIDEO_ANALYZER: return { icon: FileSearch, color: 'text-emerald-400', border: 'border-emerald-500/30' };
        case NodeType.IMAGE_EDITOR: return { icon: Edit, color: 'text-rose-400', border: 'border-rose-500/30' };
        case NodeType.SCRIPT_PLANNER: return { icon: BookOpen, color: 'text-orange-400', border: 'border-orange-500/30' };
        case NodeType.SCRIPT_EPISODE: return { icon: ScrollText, color: 'text-teal-400', border: 'border-teal-500/30' };
        case NodeType.STORYBOARD_GENERATOR: return { icon: Clapperboard, color: 'text-indigo-400', border: 'border-indigo-500/30' };
        case NodeType.STORYBOARD_IMAGE: return { icon: LayoutGrid, color: 'text-purple-400', border: 'border-purple-500/30' };
        case NodeType.CHARACTER_NODE: return { icon: User, color: 'text-orange-400', border: 'border-orange-500/30' };
        case NodeType.SCENE_NODE: return { icon: Box, color: 'text-sky-400', border: 'border-sky-500/30' };
        case NodeType.ITEM_NODE: return { icon: Package, color: 'text-green-400', border: 'border-green-500/30' };
        case NodeType.DRAMA_ANALYZER: return { icon: Film, color: 'text-violet-400', border: 'border-violet-500/30' };
        default: return { icon: Type, color: 'text-slate-400', border: 'border-white/10' };
      }
  };
  const { icon: NodeIcon } = getNodeConfig();

  const getNodeHeight = () => {
      if (node.height) return node.height;
      if (node.type === NodeType.STORYBOARD_GENERATOR) return STORYBOARD_NODE_HEIGHT;
      if (node.type === NodeType.STORYBOARD_IMAGE) return 600;
      if ([NodeType.CHARACTER_NODE, NodeType.SCENE_NODE, NodeType.ITEM_NODE].includes(node.type)) return CHARACTER_NODE_HEIGHT;
      if (node.type === NodeType.DRAMA_ANALYZER) return 600;
      if (node.type === NodeType.SORA_VIDEO_GENERATOR) return 700;
      if (node.type === NodeType.SORA_VIDEO_CHILD) return 500;
      if (node.type === NodeType.SCRIPT_PLANNER && node.data.scriptOutline) return 500;
      if (['VIDEO_ANALYZER', 'IMAGE_EDITOR', 'PROMPT_INPUT', 'SCRIPT_PLANNER', 'SCRIPT_EPISODE'].includes(node.type)) return DEFAULT_FIXED_HEIGHT;
      if (node.type === NodeType.AUDIO_GENERATOR) return AUDIO_NODE_HEIGHT;
      const ratio = node.data.aspectRatio || '16:9';
      const [w, h] = ratio.split(':').map(Number);
      const extra = (node.type === NodeType.VIDEO_GENERATOR && generationMode === 'CUT') ? 36 : 0;
      return ((node.width || DEFAULT_NODE_WIDTH) * h / w) + extra;
  };
  const nodeHeight = getNodeHeight();
  const nodeWidth = node.width || DEFAULT_NODE_WIDTH;
  const hasInputs = inputAssets && inputAssets.length > 0;

  // 固定显示的标题栏
  const renderTitleBar = () => {
    const config = getNodeConfig();
    const IconComponent = config.icon;

    return (
      <div className="absolute -top-9 left-0 w-full flex items-center justify-between px-2 pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1c1c1e]/90 backdrop-blur-xl border border-white/10 rounded-full shadow-lg">
          <IconComponent size={12} className={config.color} />
          {isEditingTitle ? (
            <input
              className="bg-transparent border-none outline-none text-slate-200 text-xs font-semibold w-32"
              value={tempTitle}
              onChange={(e) => setTempTitle(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
              onMouseDown={e => e.stopPropagation()}
              autoFocus
            />
          ) : (
            <span
              className="text-xs font-semibold text-slate-200 hover:text-white cursor-text transition-colors"
              onClick={() => setIsEditingTitle(true)}
              title="点击编辑节点名称"
            >
              {getNodeNameCN(node.type)}
            </span>
          )}
          <NodeInfoTooltip type={node.type} />
          {isWorking && <Loader2 className="animate-spin w-3 h-3 text-cyan-400 ml-1" />}
          {/* ✅ 缓存指示器 */}
          {node.data.isCached && (
            <div
              className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 border border-green-500/30 rounded-full ml-1"
              title={`从缓存加载 (${node.data.cacheLocation || 'filesystem'})`}
            >
              <Database className="w-3 h-3 text-green-400" />
              <span className="text-[9px] font-medium text-green-400">缓存</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // 悬停工具栏（用于操作按钮）
  const renderHoverToolbar = () => {
    const showToolbar = isSelected || isHovered;
    return (
      <div className={`absolute -top-9 right-0 flex items-center gap-1.5 px-1 transition-all duration-300 pointer-events-auto ${showToolbar ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2 pointer-events-none'}`}>
        {node.type === NodeType.VIDEO_GENERATOR && (<VideoModeSelector currentMode={generationMode} onSelect={(mode) => onUpdate(node.id, { generationMode: mode })} />)}
        {(node.data.image || node.data.videoUri || node.data.audioUri) && (
          <div className="flex items-center gap-1">
            <button onClick={handleDownload} className="p-1.5 bg-black/40 border border-white/10 backdrop-blur-md rounded-md text-slate-400 hover:text-white hover:border-white/30 transition-colors" title="下载"><Download size={14} /></button>
            {node.type !== NodeType.AUDIO_GENERATOR && node.type !== NodeType.STORYBOARD_IMAGE && <button onClick={handleExpand} className="p-1.5 bg-black/40 border border-white/10 backdrop-blur-md rounded-md text-slate-400 hover:text-white hover:border-white/30 transition-colors" title="全屏预览"><Maximize2 size={14} /></button>}
          </div>
        )}
      </div>
    );
  };

  // State for shot editing modal
  const [editingShot, setEditingShot] = useState<import('../../types').DetailedStoryboardShot | null>(null);
  const [editingShotIndex, setEditingShotIndex] = useState<number>(-1);


  // ==================== 提取的渲染组件 ====================

  const contentContext: NodeContentContext = {
    node, onUpdate, onAction, onDelete, onExpand, onCrop, onMediaContextMenu,
    onCharacterAction, onViewCharacter, onOpenVideoEditor,
    nodeQuery, characterLibrary, inputAssets,
    isWorking, isActionDisabled, isHovered: isHoveringRef.current, localPrompt, setLocalPrompt,
    commitPrompt, handleActionClick, handleCmdEnter, mediaRef,
    videoBlobUrl, setVideoBlobUrl, isLoadingVideo, setIsLoadingVideo,
    showImageGrid, setShowImageGrid, isPlayingAudio, setIsPlayingAudio,
    generationMode, isInputFocused, setIsInputFocused,
    inputHeight, setInputHeight, handleInputResizeStart, handleExpand,
    isUploading, fileInputRef: fileInputRef as React.RefObject<HTMLInputElement>,
    handleUploadVideo, handleUploadImage, handleAspectRatioSelect,
    localSoraConfigs, setLocalSoraConfigs,
    availableChapters, setAvailableChapters, viewingOutline, setViewingOutline,
    handleRefreshChapters,
    dynamicSubModels, dynamicSubModelNames, configLoaded,
    showExportModal, setShowExportModal, exportSettings, setExportSettings,
    isActionProcessing,
  };


  const isInteracting = isDragging || isResizing || isGroupDragging;

  // 性能优化：memoize容器样式对象，避免每次渲染创建新对象
  const containerStyle = useMemo(() => ({
      left: node.x, top: node.y, width: nodeWidth, height: nodeHeight,
      background: isSelected ? 'rgba(28, 28, 30, 0.85)' as const : 'rgba(28, 28, 30, 0.6)' as const,
      transition: isInteracting ? 'none' as const : 'all 0.5s cubic-bezier(0.32, 0.72, 0, 1)' as const,
      backdropFilter: isInteracting ? 'none' as const : 'blur(24px)' as const,
      boxShadow: isInteracting ? 'none' as const : undefined,
      willChange: isInteracting ? 'left, top, width, height' as const : 'auto' as const
  }), [node.x, node.y, nodeWidth, nodeHeight, isSelected, isInteracting]);

  // 性能优化：memoize事件处理器闭包，避免每次渲染创建新函数
  const handleNodeMouseDown = useCallback((e: React.MouseEvent) => onNodeMouseDown(e, node.id), [onNodeMouseDown, node.id]);
  const handleNodeContextMenu = useCallback((e: React.MouseEvent) => onNodeContextMenu(e, node.id), [onNodeContextMenu, node.id]);
  const handleInputPortMouseDown = useCallback((e: React.MouseEvent) => onPortMouseDown(e, node.id, 'input'), [onPortMouseDown, node.id]);
  const handleInputPortMouseUp = useCallback((e: React.MouseEvent) => onPortMouseUp(e, node.id, 'input'), [onPortMouseUp, node.id]);
  const handleOutputPortMouseDown = useCallback((e: React.MouseEvent) => onPortMouseDown(e, node.id, 'output'), [onPortMouseDown, node.id]);
  const handleOutputPortMouseUp = useCallback((e: React.MouseEvent) => onPortMouseUp(e, node.id, 'output'), [onPortMouseUp, node.id]);
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => onResizeMouseDown(e, node.id, nodeWidth, nodeHeight), [onResizeMouseDown, node.id, nodeWidth, nodeHeight]);

  return (
    <div
        data-node-container="true"
        className={`absolute rounded-[24px] group ${isSelected ? 'ring-1 ring-cyan-500/50 shadow-[0_0_40px_-10px_rgba(34,211,238,0.3)] z-30' : 'ring-1 ring-white/10 hover:ring-white/20 z-10'}`}
        style={containerStyle}
        onMouseDown={handleNodeMouseDown}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onContextMenu={handleNodeContextMenu}
    >
        {renderTitleBar()}
        {renderHoverToolbar()}
        <div className={`absolute -left-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-white/20 bg-[#1c1c1e] flex items-center justify-center transition-all duration-300 hover:scale-125 cursor-crosshair z-50 shadow-md ${isConnecting ? 'ring-2 ring-cyan-400 animate-pulse' : ''}`} onMouseDown={handleInputPortMouseDown} onMouseUp={handleInputPortMouseUp} title="Input"><Plus size={10} strokeWidth={3} className="text-white/50" /></div>
        <div className={`absolute -right-3 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border border-white/20 bg-[#1c1c1e] flex items-center justify-center transition-all duration-300 hover:scale-125 cursor-crosshair z-50 shadow-md ${isConnecting ? 'ring-2 ring-purple-400 animate-pulse' : ''}`} onMouseDown={handleOutputPortMouseDown} onMouseUp={handleOutputPortMouseUp} title="Output"><Plus size={10} strokeWidth={3} className="text-white/50" /></div>
        <div className="w-full h-full flex flex-col relative rounded-[24px] overflow-hidden bg-zinc-900"><div className="flex-1 min-h-0 relative bg-zinc-900"><MediaContent {...contentContext} /></div></div>
        <BottomPanel {...contentContext} isOpen={false} hasInputs={!!hasInputs} onInputReorder={onInputReorder} nodeWidth={nodeWidth} nodeHeight={nodeHeight} isSelected={isSelected} />
        <div className="absolute -bottom-3 -right-3 w-6 h-6 flex items-center justify-center cursor-nwse-resize text-slate-500 hover:text-white transition-colors opacity-0 group-hover:opacity-100 z-50" onMouseDown={handleResizeMouseDown}><div className="w-1.5 h-1.5 rounded-full bg-current" /></div>
    </div>
  );
};

export const Node = memo(NodeComponent, arePropsEqual);

<script lang="ts">
  import FullscreenGalleryFooter from './FullscreenGalleryFooter.svelte';
  import GalleryHeader from './GalleryHeader.svelte';
  import GalleryImageViewer from './GalleryImageViewer.svelte';
  import GalleryThumbnailStrip from './GalleryThumbnailStrip.svelte';
  import CompareThumbnailStrip from './CompareThumbnailStrip.svelte';
  import type {
    GalleryImage,
    CompareImages,
    CompareMetrics,
    CompareDomDiff,
    CompareDomDiffFinding,
    CompareQueueItem,
    ColumnMode,
  } from './gallery-types.js';

  interface Props {
    // Queue mode (for review workflow)
    queue?: GalleryImage[];
    initialIndex?: number;
    baselines?: string[];
    diffs?: string[];
    onApprove?: (filename: string) => void;
    onReject?: (filename: string) => void;
    onRerun?: (filename: string) => void;
    testRunning?: boolean;
    getImageUrl?: (type: 'baseline' | 'test' | 'diff', filename: string) => string;
    // Compare mode (for Compare Tool)
    compareImages?: CompareImages;
    compareTitle?: string;
    compareMetrics?: CompareMetrics;
    compareDomDiff?: CompareDomDiff;
    compareViewport?: string;
    compareQueue?: CompareQueueItem[];
    compareIndex?: number;
    onCompareNavigate?: (nextIndex: number) => void;
    compareThreshold?: number;
    onThresholdChange?: (threshold: number) => void;
    onRecompare?: () => Promise<void>;
    onAnalyze?: (filename?: string) => void;
    onOpenAIAnalysis?: () => void;
    onFlag?: (filename?: string) => void;
    onUnflag?: (filename?: string) => void;
    onAcceptForBrowser?: () => void;
    onRevokeAcceptance?: () => void;
    isAccepted?: boolean;
    isFlagged?: boolean;
    analyzing?: boolean;
    recomparing?: boolean;
    // Common
    onClose: () => void;
    // Optional metadata accessor (used for "Updated at" display in queue mode)
    getImageMetadata?: (
      type: 'baseline' | 'test' | 'diff',
      filename: string
    ) => { updatedAt?: string } | null;
  }

  let {
    queue = [],
    initialIndex = 0,
    baselines = [],
    diffs = [],
    onClose,
    onApprove,
    onReject,
    onRerun,
    testRunning = false,
    getImageUrl,
    compareImages,
    compareTitle,
    compareMetrics,
    compareDomDiff,
    compareViewport,
    compareQueue = [],
    compareIndex = 0,
    onCompareNavigate,
    compareThreshold = 0.1,
    onThresholdChange,
    onRecompare,
    onAnalyze,
    onOpenAIAnalysis,
    onFlag,
    onUnflag,
    onAcceptForBrowser,
    onRevokeAcceptance,
    isAccepted = false,
    isFlagged = false,
    analyzing = false,
    recomparing = false,
    getImageMetadata,
  }: Props = $props();


  // Determine mode + active compare payload
  let compareIndexValue = $derived(compareQueue.length ? Math.max(0, Math.min(compareQueue.length - 1, compareIndex)) : 0);
  let activeCompareItem = $derived(compareQueue.length ? compareQueue[compareIndexValue] : null);
  let effectiveCompareImages = $derived(activeCompareItem?.images ?? compareImages ?? null);
  let effectiveCompareTitle = $derived(activeCompareItem?.title ?? compareTitle);
  let effectiveCompareMetrics = $derived(activeCompareItem?.metrics ?? compareMetrics);
  let effectiveCompareDomDiff = $derived(activeCompareItem?.domDiff ?? compareDomDiff ?? null);
  let effectiveIsAccepted = $derived(activeCompareItem?.accepted ?? isAccepted);
  let effectiveCompareBadge = $derived(activeCompareItem?.badge ?? null);
  let effectiveCompareAIBadge = $derived.by(() => {
    const rec = activeCompareItem?.aiRecommendation;
    if (!rec) return null;
    const category = activeCompareItem?.aiCategory;
    const confidence = activeCompareItem?.aiConfidence;
    const detail =
      typeof confidence === 'number'
        ? `${category ?? 'analysis'} · ${(confidence * 100).toFixed(0)}%`
        : category ?? undefined;
    return {
      label: rec === 'approve' ? 'AI Approve' : rec === 'review' ? 'AI Review' : 'AI Reject',
      tone: rec === 'approve' ? 'ai-approved' : rec === 'review' ? 'ai-review' : 'ai-rejected',
      detail,
      category,
      confidence,
    };
  });
  let effectiveCompareViewport = $derived(activeCompareItem?.viewport ?? compareViewport ?? null);
  let effectiveCompareUpdatedAt = $derived.by(() => {
    if (!effectiveCompareImages) return null;
    return {
      left: effectiveCompareImages.left.updatedAt,
      right: effectiveCompareImages.right.updatedAt,
      diff: effectiveCompareImages.diff?.updatedAt,
    };
  });
  let hasCompareQueue = $derived(compareQueue.length > 1 && !!onCompareNavigate);
  let isCompareMode = $derived(!!effectiveCompareImages);
  let hasStructuralInsights = $derived.by(() => {
    if (!effectiveCompareDomDiff) return false;
    const count =
      effectiveCompareDomDiff.findingCount ??
      effectiveCompareDomDiff.findings?.length ??
      0;
    return count > 0;
  });
  let aiBadgePulsing = $state(false);
  let lastAIBadgeKey = '';

  $effect(() => {
    const signature = [
      compareIndexValue,
      effectiveCompareAIBadge?.label ?? '',
      effectiveCompareAIBadge?.detail ?? '',
      !!onOpenAIAnalysis,
    ].join('|');
    if (signature === lastAIBadgeKey) return;
    lastAIBadgeKey = signature;
    aiBadgePulsing = !!effectiveCompareAIBadge && !!onOpenAIAnalysis;
  });

  // Session storage keys
  const ZOOM_KEY = 'vrt-gallery-zoom';
  const OPACITY_KEY = 'vrt-gallery-opacity';
  const COLUMN_MODE_KEY = 'vrt-gallery-columns';

  function loadSavedZoom(): number {
    const saved = sessionStorage.getItem(ZOOM_KEY);
    if (saved) {
      const val = parseFloat(saved);
      if (!Number.isNaN(val) && val >= 0.01 && val <= 4) return val;
    }
    return 1;
  }

  function loadSavedOpacity(): number {
    const saved = sessionStorage.getItem(OPACITY_KEY);
    if (saved) {
      const val = parseInt(saved, 10);
      if (!Number.isNaN(val) && val >= 0 && val <= 100) return val;
    }
    return 70;
  }

  function loadSavedColumnMode(): ColumnMode {
    const saved = sessionStorage.getItem(COLUMN_MODE_KEY);
    const allowed = new Set([
      'auto',
      '1', '2', '3', '4', '5', '6', '7', '8',
      '9', '10', '11', '12', '13', '14', '15',
    ]);
    if (saved && allowed.has(saved)) {
      return saved as ColumnMode;
    }
    return 'auto';
  }

  // State
  let currentIndex = $state(initialIndex);
  let currentView = $state<'baseline' | 'test' | 'diff'>('test');
  let compareDataView = $state<'visual' | 'structural'>('visual');
  let showThumbnails = $state(false);
  let zoom = $state(loadSavedZoom());
  let isDragging = $state(false);
  let diffOpacity = $state(loadSavedOpacity());
  let localThreshold = $state(compareThreshold);
  let columnMode = $state<ColumnMode>(loadSavedColumnMode());
  let lastMultiColumnMode = $state<ColumnMode>(columnMode === '1' ? 'auto' : columnMode);
  let lastNonAutoColumnMode = $state<ColumnMode>(columnMode === 'auto' ? '1' : columnMode);
  let panicActive = $state(false);
  let panicPrevView = $state<'baseline' | 'test' | 'diff'>(currentView);
  let panicFlipHandle = 0;
  let panicDiffHandle = 0;
  let panicResumeHandle = 0;
  let panicShowingDiff = false;
  let panicNextView: 'baseline' | 'test' = 'baseline';

  function toSafeText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    return String(value);
  }

  function toTextDiffFinding(finding: CompareDomDiffFinding): {
    path: string;
    tag: string;
    before: string;
    after: string;
    description: string;
    severity: CompareDomDiffFinding['severity'];
  } | null {
    if (finding.type !== 'text_changed') return null;
    const detail = finding.detail ?? {};
    const before = toSafeText((detail as Record<string, unknown>).from);
    const after = toSafeText((detail as Record<string, unknown>).to);
    if (before === after) return null;
    return {
      path: finding.path,
      tag: finding.tag,
      before,
      after,
      description: finding.description,
      severity: finding.severity,
    };
  }

  // Zoom constants
  const ZOOM_STEP = 0.1;
  const MIN_ZOOM = 0.01;
  const MAX_ZOOM = 4;
  const MAX_COLUMNS = 15;
  const COLUMN_GAP = 16;

  // Drag state
  let dragStartX = 0;
  let dragStartY = 0;
  let scrollStartX = 0;
  let scrollStartY = 0;
  let imageContainer: HTMLDivElement;

  // Image dimensions for fit-to-height
  let imageNaturalWidth = $state(0);
  let imageNaturalHeight = $state(0);
  let containerWidth = $state(0);
  let containerHeight = $state(0);
  let columnScrollTop = $state(0);
  let scrollRatio = $state(0);
  let scrollAnchor = $state(0);

  // Image dimensions display (baseline & test)
  let baselineDims = $state<{ w: number; h: number } | null>(null);
  let testDims = $state<{ w: number; h: number } | null>(null);

  // Save zoom and opacity to session on change
  $effect(() => {
    sessionStorage.setItem(ZOOM_KEY, zoom.toString());
  });

  $effect(() => {
    sessionStorage.setItem(OPACITY_KEY, diffOpacity.toString());
  });

  $effect(() => {
    sessionStorage.setItem(COLUMN_MODE_KEY, columnMode);
  });

  $effect(() => {
    if (columnMode !== '1') {
      lastMultiColumnMode = columnMode;
    }
  });

  $effect(() => {
    if (columnMode !== 'auto') {
      lastNonAutoColumnMode = columnMode;
    }
  });

  // Derived values - handle both queue mode and compare mode
  let currentImage = $derived(queue[currentIndex]);

  // In compare mode, always have baseline (left) and diff available
  let hasBaseline = $derived(
    isCompareMode ? true : (currentImage ? baselines.includes(currentImage.filename) : false)
  );
  let hasDiff = $derived(
    isCompareMode ? !!effectiveCompareImages?.diff : (currentImage ? diffs.includes(currentImage.filename) : false)
  );

  let canAct = $derived(
    !isCompareMode && currentImage && (currentImage.status === 'failed' || currentImage.status === 'new')
  );
  let effectiveIsFlagged = $derived(
    isCompareMode ? (activeCompareItem?.flagged ?? isFlagged) : !!currentImage?.flagged
  );
  let structuralSummaryEntries = $derived.by(() => {
    if (!effectiveCompareDomDiff?.summary) return [] as Array<{ type: string; count: number }>;
    return Object.entries(effectiveCompareDomDiff.summary)
      .filter(([, count]) => (count ?? 0) > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));
  });
  let textDiffItems = $derived.by(() => {
    const findings = effectiveCompareDomDiff?.findings ?? [];
    return findings
      .map(toTextDiffFinding)
      .filter((finding): finding is NonNullable<typeof finding> => !!finding);
  });
  let structuralTopFindings = $derived.by(() => {
    if (effectiveCompareDomDiff?.topFindings?.length) return effectiveCompareDomDiff.topFindings;
    const findings = effectiveCompareDomDiff?.findings ?? [];
    return findings.slice(0, 8).map((finding) => ({
      type: finding.type,
      severity: finding.severity,
      description: finding.description,
    }));
  });

  $effect(() => {
    if (!isCompareMode || !hasStructuralInsights) {
      compareDataView = 'visual';
    }
  });

  // Title for header
  let displayTitle = $derived(
    isCompareMode ? (effectiveCompareTitle || 'Compare') : (currentImage?.filename || '')
  );

  // In diff mode: show baseline/left as base, diff as overlay
  // In other modes: show single image
  let baseImageSrc = $derived.by(() => {
    if (isCompareMode && effectiveCompareImages) {
      if (currentView === 'diff' && effectiveCompareImages.diff) {
        return effectiveCompareImages.left.src;
      }
      if (currentView === 'baseline') {
        return effectiveCompareImages.left.src;
      }
      return effectiveCompareImages.right.src;
    }
    if (!currentImage || !getImageUrl) return '';
    if (currentView === 'diff' && hasDiff && hasBaseline) {
      return getImageUrl('baseline', currentImage.filename);
    }
    if (currentView === 'baseline' && hasBaseline) {
      return getImageUrl('baseline', currentImage.filename);
    }
    return getImageUrl('test', currentImage.filename);
  });

  let overlayImageSrc = $derived.by(() => {
    if (isCompareMode && effectiveCompareImages) {
      if (currentView === 'diff' && effectiveCompareImages.diff) {
        return effectiveCompareImages.diff.src;
      }
      return null;
    }
    if (!currentImage || !getImageUrl) return null;
    if (currentView === 'diff' && hasDiff) {
      return getImageUrl('diff', currentImage.filename);
    }
    return null;
  });

  // Tab labels for compare mode
  let leftLabel = $derived(isCompareMode ? (effectiveCompareImages?.left.label || 'Left') : 'Baseline');
  let rightLabel = $derived(isCompareMode ? (effectiveCompareImages?.right.label || 'Right') : 'Test');
  let diffLabel = $derived(isCompareMode ? (effectiveCompareImages?.diff?.label || 'Diff') : 'Diff');

  let queueUpdatedAt = $derived.by(() => {
    if (isCompareMode) return null;
    if (!currentImage || !getImageMetadata) return null;

    const type: 'baseline' | 'test' | 'diff' =
      currentView === 'baseline' ? 'baseline' : currentView === 'diff' ? 'diff' : 'test';
    const label = currentView === 'baseline' ? leftLabel : currentView === 'diff' ? diffLabel : rightLabel;
    const iso = getImageMetadata(type, currentImage.filename)?.updatedAt;
    if (!iso) return null;
    return { label, iso };
  });

  // Load baseline & test dimensions when image changes
  $effect(() => {
    if (isCompareMode || !currentImage || !getImageUrl) {
      baselineDims = null;
      testDims = null;
      return;
    }
    const filename = currentImage.filename;

    if (baselines.includes(filename)) {
      const img = new Image();
      img.onload = () => { baselineDims = { w: img.naturalWidth, h: img.naturalHeight }; };
      img.onerror = () => { baselineDims = null; };
      img.src = getImageUrl('baseline', filename);
    } else {
      baselineDims = null;
    }

    const testImg = new Image();
    testImg.onload = () => { testDims = { w: testImg.naturalWidth, h: testImg.naturalHeight }; };
    testImg.onerror = () => { testDims = null; };
    testImg.src = getImageUrl('test', filename);
  });

  // Load base image dimensions for compare mode
  $effect(() => {
    if (!isCompareMode || !baseImageSrc) return;
    const img = new Image();
    img.onload = () => {
      imageNaturalWidth = img.naturalWidth;
      imageNaturalHeight = img.naturalHeight;
    };
    img.onerror = () => {
      imageNaturalWidth = 0;
      imageNaturalHeight = 0;
    };
    img.src = baseImageSrc;
  });

  function handleImageLoad(e: Event) {
    const img = e.target as HTMLImageElement;
    imageNaturalWidth = img.naturalWidth;
    imageNaturalHeight = img.naturalHeight;
    scheduleScrollRestore();
  }

  function updateContainerSize() {
    if (!imageContainer) return;
    const style = getComputedStyle(imageContainer);
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    containerWidth = Math.max(0, imageContainer.clientWidth - paddingLeft - paddingRight);
    containerHeight = Math.max(0, imageContainer.clientHeight - paddingTop - paddingBottom);
  }

  function handleResize() {
    if (resizeRafHandle) return;
    resizeRafHandle = requestAnimationFrame(() => {
      resizeRafHandle = 0;
      updateContainerSize();
      scheduleScrollRestore('anchor');
    });
  }

  function handleContainerReady(el: HTMLDivElement) {
    imageContainer = el;
    updateContainerSize();
  }

  $effect(() => {
    if (imageContainer) {
      updateContainerSize();
    }
  });

  let lastBaseImageSrc = '';
  let lastUseColumnMode = false;
  let lastEffectiveColumns = 1;
  let lastContainerWidth = 0;
  let lastContainerHeight = 0;
  let lastZoom = zoom;
  let lastImageKey = '';
  let lastView = currentView;
  let lastAutoFitKey = '';
  let centerImage = $derived.by(() => !useColumnMode && zoom <= 1);

  $effect(() => {
    if (!imageContainer) return;
    const baseChanged = baseImageSrc !== lastBaseImageSrc;
    const modeChanged = useColumnMode !== lastUseColumnMode || effectiveColumns !== lastEffectiveColumns;
    const sizeChanged = containerWidth !== lastContainerWidth || containerHeight !== lastContainerHeight;
    const zoomChanged = zoom !== lastZoom;
    const imageKey = isCompareMode
      ? (activeCompareItem ? `compare:${compareIndexValue}` : `compare:${effectiveCompareTitle ?? effectiveCompareImages?.left?.src ?? ''}`)
      : `queue:${currentImage?.filename ?? ''}`;
    const imageChanged = imageKey !== lastImageKey;
    const viewChanged = currentView !== lastView;

    lastBaseImageSrc = baseImageSrc;
    lastUseColumnMode = useColumnMode;
    lastEffectiveColumns = effectiveColumns;
    lastContainerWidth = containerWidth;
    lastContainerHeight = containerHeight;
    lastZoom = zoom;
    lastImageKey = imageKey;
    lastView = currentView;

    if (baseChanged) {
      if (!imageChanged && viewChanged) {
        scheduleScrollRestore('anchor');
      } else {
        scheduleScrollRestore('ratio');
      }
    } else if (modeChanged || sizeChanged) {
      scheduleScrollRestore('anchor');
    } else if (zoomChanged) {
      scheduleScrollRestore('ratio');
    }
  });

  $effect(() => {
    if (!isCompareMode) return;
    if (!effectiveCompareImages) return;
    const key = activeCompareItem
      ? `compare:${compareIndexValue}`
      : `compare:${effectiveCompareTitle ?? effectiveCompareImages.left.src ?? ''}`;
    if (!key || key === lastAutoFitKey) return;
    lastAutoFitKey = key;
    fitColumnsToScreen();
  });

  function zoomIn() {
    zoom = Math.min(MAX_ZOOM, zoom + ZOOM_STEP);
  }

  function zoomOut() {
    zoom = Math.max(MIN_ZOOM, zoom - ZOOM_STEP);
  }

  function resetZoom() {
    zoom = 1;
    imageContainer?.scrollTo(0, 0);
  }

  function fitToHeight() {
    if (!imageContainer || !imageNaturalHeight || !imageNaturalWidth) return;

    const style = getComputedStyle(imageContainer);
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;

    const buffer = 4;
    const availableHeight = imageContainer.clientHeight - paddingTop - paddingBottom - buffer;
    const availableWidth = imageContainer.clientWidth - paddingLeft - paddingRight;

    const targetZoom = (availableHeight * imageNaturalWidth) / (availableWidth * imageNaturalHeight);

    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));
    imageContainer?.scrollTo(0, 0);
  }

  function handleWheel(e: WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    scrollStartX = imageContainer.scrollLeft;
    scrollStartY = imageContainer.scrollTop;
    e.preventDefault();
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    if (dragRafHandle) return;
    const clientX = e.clientX;
    const clientY = e.clientY;
    dragRafHandle = requestAnimationFrame(() => {
      dragRafHandle = 0;
      imageContainer.scrollLeft = scrollStartX - (clientX - dragStartX);
      imageContainer.scrollTop = scrollStartY - (clientY - dragStartY);
    });
  }

  function handleMouseUp() {
    isDragging = false;
    if (dragRafHandle) {
      cancelAnimationFrame(dragRafHandle);
      dragRafHandle = 0;
    }
  }

  function handleScroll() {
    if (scrollRafHandle) return;
    scrollRafHandle = requestAnimationFrame(() => {
      scrollRafHandle = 0;
      if (!imageContainer) return;
      columnScrollTop = imageContainer.scrollTop;
      updateScrollRatio();
      updateScrollAnchor();
    });
  }

  function getMaxScrollable(): number {
    if (!imageContainer) return 0;
    if (useColumnMode) return maxColumnScroll;
    return Math.max(0, imageContainer.scrollHeight - imageContainer.clientHeight);
  }

  function getImageScale(): number {
    if (!imageNaturalWidth) return 0;
    if (useColumnMode) {
      if (!columnWidth) return 0;
      return columnWidth / imageNaturalWidth;
    }
    if (!containerWidth) return 0;
    return (containerWidth * zoom) / imageNaturalWidth;
  }

  function updateScrollRatio(): void {
    if (!imageContainer) return;
    const max = getMaxScrollable();
    scrollRatio = max > 0 ? imageContainer.scrollTop / max : 0;
  }

  function updateScrollAnchor(): void {
    if (!imageContainer) return;
    const scale = getImageScale();
    if (!scale) return;
    scrollAnchor = imageContainer.scrollTop / scale;
  }

  function restoreScrollRatio(): void {
    if (!imageContainer) return;
    const max = getMaxScrollable();
    const next = max > 0 ? scrollRatio * max : 0;
    if (!Number.isFinite(next)) return;
    if (Math.abs(imageContainer.scrollTop - next) > 1) {
      imageContainer.scrollTop = next;
    }
    columnScrollTop = imageContainer.scrollTop;
    updateScrollRatio();
    updateScrollAnchor();
  }

  function restoreScrollAnchor(): void {
    if (!imageContainer) return;
    const scale = getImageScale();
    if (!scale) return;
    const max = getMaxScrollable();
    let next = scrollAnchor * scale;
    if (!Number.isFinite(next)) return;
    next = Math.max(0, Math.min(max, next));
    if (Math.abs(imageContainer.scrollTop - next) > 1) {
      imageContainer.scrollTop = next;
    }
    columnScrollTop = imageContainer.scrollTop;
    updateScrollRatio();
    updateScrollAnchor();
  }

  let scrollRafHandle = 0;
  let dragRafHandle = 0;
  let scrollRestoreHandle = 0;
  let resizeRafHandle = 0;
  let scrollRestoreMode: 'ratio' | 'anchor' = 'ratio';

  function scheduleScrollRestore(mode: 'ratio' | 'anchor' = 'ratio'): void {
    scrollRestoreMode = mode;
    if (scrollRestoreHandle) {
      cancelAnimationFrame(scrollRestoreHandle);
    }
    scrollRestoreHandle = requestAnimationFrame(() => {
      scrollRestoreHandle = 0;
      if (scrollRestoreMode === 'anchor') {
        restoreScrollAnchor();
      } else {
        restoreScrollRatio();
      }
    });
  }

  function navigatePrev() {
    if (currentIndex > 0) {
      currentIndex--;
    }
  }

  function navigateNext() {
    if (currentIndex < queue.length - 1) {
      currentIndex++;
    }
  }

  function navigateComparePrev() {
    if (!hasCompareQueue || !onCompareNavigate) return;
    if (compareIndexValue > 0) {
      onCompareNavigate(compareIndexValue - 1);
    }
  }

  function navigateCompareNext() {
    if (!hasCompareQueue || !onCompareNavigate) return;
    if (compareIndexValue < compareQueue.length - 1) {
      onCompareNavigate(compareIndexValue + 1);
    }
  }

  function navigateCompareTo(index: number) {
    if (!hasCompareQueue || !onCompareNavigate) return;
    if (index >= 0 && index < compareQueue.length) {
      onCompareNavigate(index);
    }
  }

  function navigateTo(index: number) {
    if (index >= 0 && index < queue.length) {
      currentIndex = index;
    }
  }

  function handleApprove() {
    if (!currentImage) return;
    onApprove?.(currentImage.filename);
    autoAdvance();
  }

  function handleReject() {
    if (!currentImage) return;
    onReject?.(currentImage.filename);
    autoAdvance();
  }

  function handleAnalyzeAction() {
    if (!onAnalyze) return;
    if (isCompareMode) {
      onAnalyze();
      return;
    }
    if (currentImage) {
      onAnalyze(currentImage.filename);
    }
  }

  function handleFlagAction() {
    if (!onFlag) return;
    if (isCompareMode) {
      onFlag();
      return;
    }
    if (currentImage) {
      onFlag(currentImage.filename);
    }
  }

  function handleUnflagAction() {
    if (!onUnflag) return;
    if (isCompareMode) {
      onUnflag();
      return;
    }
    if (currentImage) {
      onUnflag(currentImage.filename);
    }
  }

  function autoAdvance() {
    if (currentIndex < queue.length - 1) {
      // Don't increment - the queue will update and shift
    } else if (currentIndex > 0) {
      currentIndex--;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    const handledKeys = [
      'Escape', 'ArrowLeft', 'ArrowRight',
      '1', '2', '3', '4',
      'a', 'A', 'u', 'U', 'r', 'R', 't', 'T',
      'g', 'G',
      '+', '=', '-',
      'w', 'W', 'h', 'H', 'f', 'F', 'c', 'C', 'p', 'P',
    ];
    if (handledKeys.includes(e.key)) {
      e.preventDefault();
    }

    switch (e.key) {
      case 'Escape':
        onClose();
        break;
      case 'ArrowLeft':
        if (isCompareMode) navigateComparePrev();
        else navigatePrev();
        break;
      case 'ArrowRight':
        if (isCompareMode) navigateCompareNext();
        else navigateNext();
        break;
      case '1':
        if (panicActive) stopPanic();
        compareDataView = 'visual';
        if (hasBaseline) currentView = 'baseline';
        break;
      case '2':
        if (panicActive) stopPanic();
        compareDataView = 'visual';
        currentView = 'test';
        break;
      case '3':
        if (panicActive) stopPanic();
        compareDataView = 'visual';
        if (hasDiff) currentView = 'diff';
        break;
      case '4':
        if (isCompareMode && hasStructuralInsights) {
          compareDataView = 'structural';
        }
        break;
      case 'a':
      case 'A':
        if (isCompareMode) {
          if (!effectiveIsAccepted && onAcceptForBrowser) onAcceptForBrowser();
        } else if (canAct) {
          handleApprove();
        }
        break;
      case 'u':
      case 'U':
        if (isCompareMode && effectiveIsAccepted && onRevokeAcceptance) {
          onRevokeAcceptance();
        }
        break;
      case 'r':
      case 'R':
        if (canAct) handleReject();
        break;
      case 't':
      case 'T':
        showThumbnails = !showThumbnails;
        break;
      case 'g':
      case 'G':
        if (effectiveIsFlagged) {
          handleUnflagAction();
        } else {
          handleFlagAction();
        }
        break;
      case '+':
      case '=':
        zoomIn();
        break;
      case '-':
        zoomOut();
        break;
      case 'w':
      case 'W':
        resetZoom();
        break;
      case 'h':
      case 'H':
        fitToHeight();
        break;
      case 'f':
      case 'F':
        toggleAutoFit();
        break;
      case 'c':
      case 'C':
        if (baseImageSrc) toggleColumnMode();
        break;
      case 'p':
      case 'P':
        if (hasBaseline) togglePanic();
        break;
    }
  }

  function stopPanic() {
    panicActive = false;
    if (panicFlipHandle) {
      clearInterval(panicFlipHandle);
      panicFlipHandle = 0;
    }
    if (panicDiffHandle) {
      clearInterval(panicDiffHandle);
      panicDiffHandle = 0;
    }
    if (panicResumeHandle) {
      clearTimeout(panicResumeHandle);
      panicResumeHandle = 0;
    }
    panicShowingDiff = false;
    currentView = panicPrevView;
  }

  function togglePanic() {
    if (!hasBaseline) return;
    if (panicActive) {
      stopPanic();
      return;
    }
    panicPrevView = currentView;
    panicActive = true;
  }

  function startPanicLoop() {
    if (!hasBaseline) return;
    panicNextView = 'baseline';
    panicShowingDiff = false;
    currentView = panicNextView;
    panicNextView = panicNextView === 'baseline' ? 'test' : 'baseline';

    panicFlipHandle = window.setInterval(() => {
      if (!panicActive || panicShowingDiff) return;
      currentView = panicNextView;
      panicNextView = panicNextView === 'baseline' ? 'test' : 'baseline';
    }, 250);

    panicDiffHandle = window.setInterval(() => {
      if (!panicActive || !hasDiff) return;
      panicShowingDiff = true;
      currentView = 'diff';
      if (panicResumeHandle) clearTimeout(panicResumeHandle);
      panicResumeHandle = window.setTimeout(() => {
        panicShowingDiff = false;
        currentView = panicNextView;
        panicNextView = panicNextView === 'baseline' ? 'test' : 'baseline';
      }, 700);
    }, 7000);
  }

  $effect(() => {
    if (!panicActive) return;
    const panicKey = isCompareMode
      ? `compare:${compareIndexValue}`
      : `queue:${currentImage?.filename ?? ''}`;
    panicKey;
    startPanicLoop();
    return () => {
      if (panicFlipHandle) clearInterval(panicFlipHandle);
      if (panicDiffHandle) clearInterval(panicDiffHandle);
      if (panicResumeHandle) clearTimeout(panicResumeHandle);
      panicFlipHandle = 0;
      panicDiffHandle = 0;
      panicResumeHandle = 0;
      panicShowingDiff = false;
    };
  });

  // Close gallery if queue becomes empty (only in queue mode)
  $effect(() => {
    if (!isCompareMode && queue.length === 0) {
      onClose();
    }
  });

  // Clamp currentIndex if queue shrinks (only in queue mode)
  $effect(() => {
    if (!isCompareMode && currentIndex >= queue.length && queue.length > 0) {
      currentIndex = queue.length - 1;
    }
  });

  // Prevent body scroll when gallery is open
  $effect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  });

  function parseViewportRatio(viewport?: string | null): number | null {
    if (!viewport) return null;
    const match = viewport.match(/(\d+)\s*[xX]\s*(\d+)/);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return height / width;
  }

  let effectiveViewportRatio = $derived.by(() => parseViewportRatio(effectiveCompareViewport));

  let columnSegmentHeight = $derived.by(() => {
    return Math.max(1, containerHeight || 1);
  });

  function computeAutoColumns(): number {
    if (!imageNaturalHeight || !imageNaturalWidth) return 1;
    const referenceRatio = effectiveViewportRatio ?? (containerHeight && containerWidth ? containerHeight / containerWidth : 0);
    if (!referenceRatio) return 1;
    const ratio = (imageNaturalHeight / imageNaturalWidth) / referenceRatio;
    const auto = Math.ceil(Math.sqrt(Math.max(1, ratio)));
    return Math.min(MAX_COLUMNS, Math.max(1, auto));
  }

  let effectiveColumns = $derived.by(() => {
    if (columnMode !== 'auto') {
      return Math.min(MAX_COLUMNS, Math.max(1, Number.parseInt(columnMode, 10)));
    }
    return computeAutoColumns();
  });

  let useColumnMode = $derived(effectiveColumns > 1);

  let columnWidth = $derived.by(() => {
    if (!containerWidth || !effectiveColumns) return 0;
    const gapTotal = COLUMN_GAP * Math.max(0, effectiveColumns - 1);
    const available = Math.max(0, containerWidth - gapTotal);
    const baseWidth = available / effectiveColumns;
    const columnZoom = zoom;
    return baseWidth * columnZoom;
  });

  let scaledHeight = $derived.by(() => {
    if (!imageNaturalWidth || !imageNaturalHeight || !columnWidth) return 0;
    return (imageNaturalHeight / imageNaturalWidth) * columnWidth;
  });

  let maxColumnScroll = $derived.by(() => {
    if (!scaledHeight) return 0;
    const max = scaledHeight - columnSegmentHeight * effectiveColumns;
    return max > 0 ? max : 0;
  });

  let columnScrollHeight = $derived.by(() => {
    if (!containerHeight) return 0;
    return containerHeight + maxColumnScroll;
  });

  let columnIndexes = $derived(Array.from({ length: effectiveColumns }, (_, i) => i));

  $effect(() => {
    if (!imageContainer) return;
    if (columnScrollTop > maxColumnScroll) {
      columnScrollTop = maxColumnScroll;
      imageContainer.scrollTop = maxColumnScroll;
    }
  });

  function getColumnOffset(index: number): number {
    if (!scaledHeight) return 0;
    const maxStart = Math.max(0, scaledHeight - columnSegmentHeight);
    const start = index * columnSegmentHeight + columnScrollTop;
    return Math.min(start, maxStart);
  }

  function fitColumnsToScreen() {
    columnMode = 'auto';
    zoom = 1;
    columnScrollTop = 0;
    imageContainer?.scrollTo(0, 0);
  }

  function toggleAutoFit() {
    if (!baseImageSrc) return;
    if (columnMode === 'auto') {
      columnMode = lastNonAutoColumnMode;
      return;
    }
    fitColumnsToScreen();
  }

  function toggleColumnMode() {
    if (columnMode === '1') {
      columnMode = lastMultiColumnMode === '1' ? 'auto' : lastMultiColumnMode;
    } else {
      lastMultiColumnMode = columnMode;
      columnMode = '1';
    }
  }

  function handleOpenAIAnalysis() {
    aiBadgePulsing = false;
    onOpenAIAnalysis?.();
  }
</script>

<svelte:window
  onkeydown={handleKeyDown}
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
  onresize={handleResize}
/>

<div
  class="gallery-overlay"
  class:flagged={effectiveIsFlagged}
  role="dialog"
  aria-modal="true"
  aria-label="Image Gallery"
>
  <GalleryHeader
    {isCompareMode}
    {displayTitle}
    {effectiveCompareBadge}
    {effectiveCompareAIBadge}
    {aiBadgePulsing}
    onOpenAIAnalysis={onOpenAIAnalysis ? handleOpenAIAnalysis : undefined}
    effectiveCompareUpdatedAt={effectiveCompareUpdatedAt}
    {queueUpdatedAt}
    {hasCompareQueue}
    {compareIndexValue}
    compareQueueLength={compareQueue.length}
    {effectiveCompareMetrics}
    {currentImage}
    {currentIndex}
    queueLength={queue.length}
    {baselineDims}
    {testDims}
    {currentView}
    {hasDiff}
    {hasBaseline}
    {diffOpacity}
    {leftLabel}
    {rightLabel}
    {diffLabel}
    {zoom}
    {columnMode}
    {baseImageSrc}
    {localThreshold}
    {recomparing}
    onViewChange={(view) => {
      if (panicActive) stopPanic();
      compareDataView = 'visual';
      currentView = view;
    }}
    onZoomIn={zoomIn}
    onZoomOut={zoomOut}
    onResetZoom={resetZoom}
    onFitToHeight={fitToHeight}
    onColumnModeChange={(mode) => { columnMode = mode; }}
    onToggleColumnMode={toggleColumnMode}
    onDiffOpacityChange={(value) => { diffOpacity = value; }}
    onClose={onClose}
    {onRecompare}
    {onThresholdChange}
    onLocalThresholdChange={(value) => { localThreshold = value; }}
  />

  {#if isCompareMode && hasStructuralInsights}
    <div class="compare-data-tabs" role="tablist" aria-label="Compare data view">
      <button
        class="data-tab"
        class:active={compareDataView === 'visual'}
        role="tab"
        aria-selected={compareDataView === 'visual'}
        onclick={() => (compareDataView = 'visual')}
      >
        Visual <kbd>1-3</kbd>
      </button>
      <button
        class="data-tab"
        class:active={compareDataView === 'structural'}
        role="tab"
        aria-selected={compareDataView === 'structural'}
        onclick={() => (compareDataView = 'structural')}
      >
        Structural/Text <kbd>4</kbd>
      </button>
    </div>
  {/if}

  {#if isCompareMode && compareDataView === 'structural' && hasStructuralInsights}
    {@const structuralTotal = effectiveCompareDomDiff?.findingCount ?? effectiveCompareDomDiff?.findings?.length ?? 0}
    <section class="structural-panel" aria-live="polite">
      <div class="structural-head">
        <div class="structural-title-row">
          <span class="structural-title">Structural/Text Diff</span>
          <span class="structural-meta">
            Similarity: {((effectiveCompareDomDiff?.similarity ?? 0) * 100).toFixed(1)}% · Findings: {structuralTotal}
          </span>
        </div>
        {#if structuralSummaryEntries.length > 0}
          <div class="structural-summary">
            {#each structuralSummaryEntries as entry}
              <span class="structural-chip">{entry.type}: {entry.count}</span>
            {/each}
          </div>
        {/if}
      </div>

      {#if textDiffItems.length > 0}
        <div class="structural-section">
          <h4>Text Changes ({textDiffItems.length})</h4>
          <div class="text-diff-list">
            {#each textDiffItems as textChange}
              <article class="text-diff-item severity-{textChange.severity}">
                <div class="text-diff-title">
                  <span class="text-diff-path">{textChange.path}</span>
                  <span class="text-diff-tag">&lt;{textChange.tag}&gt;</span>
                </div>
                <p class="text-diff-description">{textChange.description}</p>
                <pre class="text-diff-block">- {textChange.before || '<empty>'}
+ {textChange.after || '<empty>'}</pre>
              </article>
            {/each}
          </div>
        </div>
      {/if}

      {#if structuralTopFindings.length > 0}
        <div class="structural-section">
          <h4>Top Structural Findings</h4>
          <ul class="structural-finding-list">
            {#each structuralTopFindings as finding}
              <li class="structural-finding severity-{finding.severity}">
                <span class="finding-type">{finding.type}</span>
                <span class="finding-desc">{finding.description}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </section>
  {:else}
    <GalleryImageViewer
      {isCompareMode}
      {hasCompareQueue}
      {currentImage}
      {currentIndex}
      queueLength={queue.length}
      {compareIndexValue}
      compareQueueLength={compareQueue.length}
      {showThumbnails}
      {isDragging}
      {useColumnMode}
      {centerImage}
      {baseImageSrc}
      {overlayImageSrc}
      {displayTitle}
      {zoom}
      {diffOpacity}
      {columnWidth}
      {scaledHeight}
      {columnSegmentHeight}
      {columnScrollHeight}
      {effectiveColumns}
      {columnIndexes}
      {getColumnOffset}
      onNavigatePrev={isCompareMode ? navigateComparePrev : navigatePrev}
      onNavigateNext={isCompareMode ? navigateCompareNext : navigateNext}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onScroll={handleScroll}
      onImageLoad={handleImageLoad}
      onContainerReady={handleContainerReady}
    />

    {#if showThumbnails && !isCompareMode && getImageUrl}
      <GalleryThumbnailStrip
        {queue}
        {currentIndex}
        {getImageUrl}
        onNavigateTo={navigateTo}
      />
    {/if}

    {#if showThumbnails && isCompareMode && hasCompareQueue}
      <CompareThumbnailStrip
        queue={compareQueue}
        currentIndex={compareIndexValue}
        onNavigateTo={navigateCompareTo}
      />
    {/if}
  {/if}

  {#if effectiveIsFlagged}
    <div class="flagged-banner">FLAGGED FOR REVIEW</div>
  {/if}

  <FullscreenGalleryFooter
    {isCompareMode}
    {queue}
    {currentImage}
    {canAct}
    panicAvailable={hasBaseline}
    {panicActive}
    thumbnailsAvailable={isCompareMode ? (hasCompareQueue && compareDataView === 'visual') : queue.length > 1}
    thumbnailsActive={showThumbnails}
    autoFitAvailable={compareDataView === 'visual' && !!baseImageSrc}
    autoFitActive={compareDataView === 'visual' && !!baseImageSrc && columnMode === 'auto'}
    onTogglePanic={togglePanic}
    onToggleThumbnails={() => { showThumbnails = !showThumbnails; }}
    onToggleAutoFit={toggleAutoFit}
    onApprove={() => handleApprove()}
    onReject={() => handleReject()}
    {onRerun}
    {testRunning}
    onAnalyze={onAnalyze ? handleAnalyzeAction : undefined}
    onFlag={onFlag ? handleFlagAction : undefined}
    onUnflag={onUnflag ? handleUnflagAction : undefined}
    {analyzing}
    canAnalyze={isCompareMode || (!!currentImage && hasBaseline)}
    isAccepted={effectiveIsAccepted}
    isFlagged={effectiveIsFlagged}
    {onRevokeAcceptance}
    {onAcceptForBrowser}
  />
</div>

<style>
  .gallery-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.98);
    display: flex;
    flex-direction: column;
    border: 2px solid transparent;
    box-sizing: border-box;
  }

  .gallery-overlay.flagged {
    border-color: rgba(255, 107, 0, 0.95);
    box-shadow: inset 0 0 0 1px rgba(255, 107, 0, 0.5);
  }

  .flagged-banner {
    margin: 0 16px;
    padding: 5px 10px;
    border: 1px solid rgba(255, 107, 0, 0.85);
    border-bottom: 0;
    color: #ff6b00;
    background: rgba(255, 107, 0, 0.12);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    letter-spacing: 0.1em;
    text-align: center;
    text-transform: uppercase;
  }

  .compare-data-tabs {
    display: flex;
    gap: 8px;
    padding: 8px 16px 0;
  }

  .data-tab {
    border: 1px solid var(--border, #2a2f36);
    background: transparent;
    color: var(--text-muted, #9ba3af);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 5px 10px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .data-tab.active {
    color: var(--text-strong, #f8fafc);
    border-color: var(--accent, #4ade80);
  }

  .data-tab kbd {
    border: 1px solid var(--border, #2a2f36);
    padding: 0 5px;
    font-size: 10px;
    color: var(--text-muted, #9ba3af);
  }

  .structural-panel {
    margin: 8px 16px 12px;
    border: 1px solid var(--border, #2a2f36);
    background: rgba(10, 14, 18, 0.96);
    color: var(--text-strong, #f8fafc);
    overflow: auto;
    min-height: 0;
    flex: 1;
    padding: 14px;
  }

  .structural-head {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 14px;
  }

  .structural-title-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
  }

  .structural-title {
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--accent, #4ade80);
  }

  .structural-meta {
    font-size: 12px;
    color: var(--text-muted, #9ba3af);
  }

  .structural-summary {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .structural-chip {
    border: 1px solid var(--border, #2a2f36);
    padding: 4px 8px;
    font-size: 11px;
    color: var(--text-muted, #9ba3af);
    background: rgba(255, 255, 255, 0.02);
  }

  .structural-section {
    margin-bottom: 16px;
  }

  .structural-section h4 {
    margin: 0 0 10px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted, #9ba3af);
  }

  .text-diff-list {
    display: grid;
    gap: 10px;
  }

  .text-diff-item {
    border: 1px solid var(--border, #2a2f36);
    padding: 10px;
    background: rgba(255, 255, 255, 0.01);
  }

  .text-diff-item.severity-warning {
    border-color: rgba(250, 204, 21, 0.45);
  }

  .text-diff-item.severity-critical {
    border-color: rgba(251, 113, 133, 0.55);
  }

  .text-diff-title {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
    font-size: 11px;
  }

  .text-diff-path {
    color: var(--text-strong, #f8fafc);
    font-family: var(--font-mono, monospace);
  }

  .text-diff-tag {
    color: var(--text-muted, #9ba3af);
    font-family: var(--font-mono, monospace);
  }

  .text-diff-description {
    margin: 0 0 8px;
    color: var(--text-muted, #9ba3af);
    font-size: 12px;
  }

  .text-diff-block {
    margin: 0;
    border: 1px solid var(--border, #2a2f36);
    background: rgba(0, 0, 0, 0.35);
    padding: 8px;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    line-height: 1.35;
  }

  .structural-finding-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 8px;
  }

  .structural-finding {
    border: 1px solid var(--border, #2a2f36);
    padding: 8px;
    display: grid;
    gap: 5px;
    background: rgba(255, 255, 255, 0.01);
  }

  .structural-finding.severity-warning {
    border-color: rgba(250, 204, 21, 0.45);
  }

  .structural-finding.severity-critical {
    border-color: rgba(251, 113, 133, 0.55);
  }

  .finding-type {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--accent, #4ade80);
    text-transform: uppercase;
    letter-spacing: 0.07em;
  }

  .finding-desc {
    font-size: 12px;
    color: var(--text-muted, #9ba3af);
  }
</style>

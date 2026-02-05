<script lang="ts">
  import FullscreenGalleryFooter from './FullscreenGalleryFooter.svelte';
  type ImageStatus = 'passed' | 'failed' | 'new';

  interface GalleryImage {
    filename: string;
    status: ImageStatus;
    confidence?: { score: number; pass: boolean; verdict: 'pass' | 'warn' | 'fail' };
    metrics?: { pixelDiff: number; diffPercentage: number; ssimScore?: number };
  }

  interface ImageInfo {
    src: string;
    label: string;
  }

  interface CompareImages {
    left: ImageInfo;
    right: ImageInfo;
    diff?: ImageInfo;
  }

  interface CompareMetrics {
    pixelDiff: number;
    diffPercentage: number;
    ssimScore?: number;
    phash?: { similarity: number };
  }

  interface CompareQueueItem {
    images: CompareImages;
    title: string;
    metrics?: CompareMetrics;
    accepted?: boolean;
    badge?: { label: string; tone: 'approved' | 'smart' | 'passed' | 'diff' | 'unapproved' | 'issue' };
    viewport?: string;
  }

  type ColumnMode =
    | 'auto'
    | '1'
    | '2'
    | '3'
    | '4'
    | '5'
    | '6'
    | '7'
    | '8'
    | '9'
    | '10'
    | '11'
    | '12'
    | '13'
    | '14'
    | '15';

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
    compareViewport?: string;
    compareQueue?: CompareQueueItem[];
    compareIndex?: number;
    onCompareNavigate?: (nextIndex: number) => void;
    compareThreshold?: number;
    onThresholdChange?: (threshold: number) => void;
    onRecompare?: () => Promise<void>;
    onAnalyze?: () => void;
    onAcceptForBrowser?: () => void;
    onRevokeAcceptance?: () => void;
    isAccepted?: boolean;
    analyzing?: boolean;
    recomparing?: boolean;
    // Common
    onClose: () => void;
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
    compareViewport,
    compareQueue = [],
    compareIndex = 0,
    onCompareNavigate,
    compareThreshold = 0.1,
    onThresholdChange,
    onRecompare,
    onAnalyze,
    onAcceptForBrowser,
    onRevokeAcceptance,
    isAccepted = false,
    analyzing = false,
    recomparing = false,
  }: Props = $props();


  // Determine mode + active compare payload
  let compareIndexValue = $derived(compareQueue.length ? Math.max(0, Math.min(compareQueue.length - 1, compareIndex)) : 0);
  let activeCompareItem = $derived(compareQueue.length ? compareQueue[compareIndexValue] : null);
  let effectiveCompareImages = $derived(activeCompareItem?.images ?? compareImages ?? null);
  let effectiveCompareTitle = $derived(activeCompareItem?.title ?? compareTitle);
  let effectiveCompareMetrics = $derived(activeCompareItem?.metrics ?? compareMetrics);
  let effectiveIsAccepted = $derived(activeCompareItem?.accepted ?? isAccepted);
  let effectiveCompareBadge = $derived(activeCompareItem?.badge ?? null);
  let effectiveCompareViewport = $derived(activeCompareItem?.viewport ?? compareViewport ?? null);
  let hasCompareQueue = $derived(compareQueue.length > 1 && !!onCompareNavigate);
  let isCompareMode = $derived(!!effectiveCompareImages);

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
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
    ]);
    if (saved && allowed.has(saved)) {
      return saved;
    }
    return 'auto';
  }

  // State
  let currentIndex = $state(initialIndex);
  let currentView = $state<'baseline' | 'test' | 'diff'>('test');
  let showThumbnails = $state(false);
  let zoom = $state(loadSavedZoom());
  let isDragging = $state(false);
  let diffOpacity = $state(loadSavedOpacity());
  let localThreshold = $state(compareThreshold);
  let columnMode = $state<ColumnMode>(loadSavedColumnMode());
  let lastMultiColumnMode = $state<ColumnMode>(columnMode === '1' ? 'auto' : columnMode);

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
    updateContainerSize();
    scheduleScrollRestore('anchor');
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

    // Account for container padding to get actual available space
    const style = getComputedStyle(imageContainer);
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;

    // Small buffer to prevent any cutoff from rounding/subpixel issues
    const buffer = 4;
    const availableHeight = imageContainer.clientHeight - paddingTop - paddingBottom - buffer;
    const availableWidth = imageContainer.clientWidth - paddingLeft - paddingRight;

    // Calculate zoom so image height fits available height
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
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    imageContainer.scrollLeft = scrollStartX - dx;
    imageContainer.scrollTop = scrollStartY - dy;
  }

  function handleMouseUp() {
    isDragging = false;
  }

  function handleScroll() {
    if (!imageContainer) return;
    columnScrollTop = imageContainer.scrollTop;
    updateScrollRatio();
    updateScrollAnchor();
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

  let scrollRestoreHandle = 0;
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
      resetViewForCurrentImage();
    }
  }

  function navigateNext() {
    if (currentIndex < queue.length - 1) {
      currentIndex++;
      resetViewForCurrentImage();
    }
  }

  function navigateComparePrev() {
    if (!hasCompareQueue || !onCompareNavigate) return;
    if (compareIndexValue > 0) {
      onCompareNavigate(compareIndexValue - 1);
      resetViewForCurrentImage();
    }
  }

  function navigateCompareNext() {
    if (!hasCompareQueue || !onCompareNavigate) return;
    if (compareIndexValue < compareQueue.length - 1) {
      onCompareNavigate(compareIndexValue + 1);
      resetViewForCurrentImage();
    }
  }

  function navigateTo(index: number) {
    if (index >= 0 && index < queue.length) {
      currentIndex = index;
      resetViewForCurrentImage();
    }
  }

  function resetViewForCurrentImage() {
    // Keep current view selection when navigating - don't reset
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

  function autoAdvance() {
    // After approve/reject, move to next image in queue
    // If at end, try to stay at last index (will be recomputed if queue shrinks)
    if (currentIndex < queue.length - 1) {
      // Don't increment - the queue will update and shift
    } else if (currentIndex > 0) {
      currentIndex--;
    }
    // If queue becomes empty, gallery will close automatically
  }

  function handleKeyDown(e: KeyboardEvent) {
    const handledKeys = [
      'Escape',
      'ArrowLeft',
      'ArrowRight',
      '1',
      '2',
      '3',
      'a',
      'A',
      'u',
      'U',
      'r',
      'R',
      't',
      'T',
      '+',
      '=',
      '-',
      'w',
      'W',
      'h',
      'H',
      'f',
      'F',
      'c',
      'C',
    ];
    if (handledKeys.includes(e.key)) {
      e.preventDefault();
    }

    switch (e.key) {
      case 'Escape':
        onClose();
        break;
      case 'ArrowLeft':
        if (isCompareMode) {
          navigateComparePrev();
        } else {
          navigatePrev();
        }
        break;
      case 'ArrowRight':
        if (isCompareMode) {
          navigateCompareNext();
        } else {
          navigateNext();
        }
        break;
      case '1':
        if (hasBaseline) currentView = 'baseline';
        break;
      case '2':
        currentView = 'test';
        break;
      case '3':
        if (hasDiff) currentView = 'diff';
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
        fitColumnsToScreen();
        break;
      case 'c':
      case 'C':
        if (baseImageSrc) toggleColumnMode();
        break;
    }
  }

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

  function getStatusColor(status: ImageStatus): string {
    switch (status) {
      case 'failed':
        return '#ef4444';
      case 'new':
        return '#f59e0b';
      case 'passed':
        return '#22c55e';
    }
  }

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

  function toggleColumnMode() {
    if (columnMode === '1') {
      columnMode = lastMultiColumnMode === '1' ? 'auto' : lastMultiColumnMode;
    } else {
      lastMultiColumnMode = columnMode;
      columnMode = '1';
    }
  }
</script>

<svelte:window
  onkeydown={handleKeyDown}
  onmousemove={handleMouseMove}
  onmouseup={handleMouseUp}
  onresize={handleResize}
/>

<div class="gallery-overlay" role="dialog" aria-modal="true" aria-label="Image Gallery">
  <!-- Top Bar -->
  <div class="gallery-header">
    <div class="header-left">
      {#if isCompareMode}
        <span class="filename" title={displayTitle}>{displayTitle}</span>
        {#if effectiveCompareBadge}
          <span class="compare-badge {`tone-${effectiveCompareBadge.tone}`.trim()}">
            {effectiveCompareBadge.label}
          </span>
        {/if}
        {#if hasCompareQueue}
          <span class="position-indicator compare-count">
            {compareIndexValue + 1} / {compareQueue.length}
          </span>
        {/if}
        {#if effectiveCompareMetrics}
          <div class="metrics-display">
            <span
              class="metric"
              title="Number of pixels that differ between baseline and test."
            >
              <span class="metric-label">Pixels</span>
              <span class="metric-value">{effectiveCompareMetrics.pixelDiff.toLocaleString()}</span>
            </span>
            <span
              class="metric"
              title="Percentage of differing pixels (pixel diff ÷ total pixels)."
            >
              <span class="metric-label">Diff</span>
              <span class="metric-value">{effectiveCompareMetrics.diffPercentage.toFixed(2)}%</span>
            </span>
            {#if effectiveCompareMetrics.ssimScore !== undefined}
              <span
                class="metric"
                title="SSIM (Structural Similarity Index). Higher is more similar."
              >
                <span class="metric-label">SSIM</span>
                <span class="metric-value">{(effectiveCompareMetrics.ssimScore * 100).toFixed(1)}%</span>
              </span>
            {/if}
            {#if effectiveCompareMetrics.phash}
              <span
                class="metric"
                title="Perceptual hash similarity. Higher is more similar."
              >
                <span class="metric-label">pHash</span>
                <span class="metric-value">{(effectiveCompareMetrics.phash.similarity * 100).toFixed(1)}%</span>
              </span>
            {/if}
          </div>
        {/if}
      {:else}
        <span class="position-indicator">{currentIndex + 1} / {queue.length}</span>
        {#if currentImage}
          <span class="filename" title={currentImage.filename}>{currentImage.filename}</span>
          <span class="status-badge" style="background: {getStatusColor(currentImage.status)}">
            {currentImage.status}
          </span>
          {#if currentImage.confidence}
            <span class="confidence-badge {currentImage.confidence.verdict}">
              {currentImage.confidence.score}%
            </span>
          {/if}
          {#if currentImage.metrics}
            <div class="metrics-display compact">
              <span
                class="metric"
                title="Percentage of differing pixels (pixel diff ÷ total pixels)."
              >
                <span class="metric-label">Diff</span>
                <span class="metric-value">{currentImage.metrics.diffPercentage.toFixed(2)}%</span>
              </span>
              {#if currentImage.metrics.ssimScore !== undefined}
                <span
                  class="metric"
                  title="SSIM (Structural Similarity Index). Higher is more similar."
                >
                  <span class="metric-label">SSIM</span>
                  <span class="metric-value">{(currentImage.metrics.ssimScore * 100).toFixed(1)}%</span>
                </span>
              {/if}
            </div>
          {/if}
          {#if baselineDims || testDims}
            <div class="dims-display">
              {#if baselineDims}
                <span class="dim-item">
                  <span class="dim-label">B:</span>
                  <span class="dim-value">{baselineDims.w}x{baselineDims.h}</span>
                </span>
              {/if}
              {#if testDims}
                <span class="dim-item">
                  <span class="dim-label">T:</span>
                  <span class="dim-value">{testDims.w}x{testDims.h}</span>
                </span>
              {/if}
              {#if baselineDims && testDims && (baselineDims.w !== testDims.w || baselineDims.h !== testDims.h)}
                <span class="dim-mismatch" title="Dimension mismatch">!</span>
              {/if}
            </div>
          {/if}
        {/if}
      {/if}
      {#if currentView === 'diff' && hasDiff}
        <div class="opacity-control">
          <span class="opacity-label">Diff:</span>
          <input
            type="range"
            min="0"
            max="100"
            bind:value={diffOpacity}
            class="opacity-slider"
          />
          <span class="opacity-value">{diffOpacity}%</span>
        </div>
      {/if}
    </div>

    <div class="header-center">
      <div class="view-tabs">
        <button
          class="view-tab"
          class:active={currentView === 'baseline'}
          class:disabled={!hasBaseline}
          onclick={() => hasBaseline && (currentView = 'baseline')}
          disabled={!hasBaseline}
        >
          {leftLabel} <kbd>1</kbd>
        </button>
        <button
          class="view-tab"
          class:active={currentView === 'test'}
          onclick={() => (currentView = 'test')}
        >
          {rightLabel} <kbd>2</kbd>
        </button>
        <button
          class="view-tab"
          class:active={currentView === 'diff'}
          class:disabled={!hasDiff}
          onclick={() => hasDiff && (currentView = 'diff')}
          disabled={!hasDiff}
        >
          {diffLabel} <kbd>3</kbd>
        </button>
      </div>

      <div class="zoom-controls">
        <button class="zoom-btn" onclick={zoomOut}>-</button>
        <span class="zoom-level">{Math.round(zoom * 100)}%</span>
        <button class="zoom-btn" onclick={zoomIn}>+</button>
        <button class="zoom-btn" onclick={resetZoom} title="Fit width (W)">W</button>
        <button class="zoom-btn" onclick={fitToHeight} title="Fit height (H)">H</button>
      </div>
      {#if baseImageSrc}
        <div class="column-controls">
          <label for="column-mode">Columns</label>
          <select id="column-mode" bind:value={columnMode}>
            <option value="auto">Auto</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
            <option value="6">6</option>
            <option value="7">7</option>
            <option value="8">8</option>
            <option value="9">9</option>
            <option value="10">10</option>
            <option value="11">11</option>
            <option value="12">12</option>
            <option value="13">13</option>
            <option value="14">14</option>
            <option value="15">15</option>
          </select>
          <button class="fit-columns-btn" onclick={toggleColumnMode} title="Toggle single/multi column (C)">
            {columnMode === '1' ? 'Multi' : 'Single'}
          </button>
          <button
            class="fit-columns-btn"
            class:active={columnMode === 'auto'}
            onclick={fitColumnsToScreen}
            title="Auto-fit columns (F)"
          >
            Auto Fit
          </button>
        </div>
      {/if}
    </div>

    <div class="header-right">
      {#if isCompareMode && onRecompare}
        <div class="threshold-control">
          <span class="threshold-label">Threshold:</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            bind:value={localThreshold}
            class="threshold-slider"
            onchange={() => onThresholdChange?.(localThreshold)}
          />
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            bind:value={localThreshold}
            class="threshold-input"
            onchange={() => onThresholdChange?.(localThreshold)}
          />
          <button
            class="action-btn recompare"
            onclick={onRecompare}
            disabled={recomparing}
          >
            {recomparing ? 'Comparing...' : 'Re-compare'}
          </button>
        </div>
      {/if}
      {#if !isCompareMode}
        <button class="thumbnail-toggle" class:active={showThumbnails} onclick={() => (showThumbnails = !showThumbnails)}>
          Thumbnails <kbd>T</kbd>
        </button>
      {/if}
      <button class="close-btn" onclick={onClose}>
        Close <kbd>Esc</kbd>
      </button>
    </div>
  </div>

  <!-- Main Image Area -->
  <div class="gallery-main" class:with-thumbnails={showThumbnails && !isCompareMode}>
    <!-- Navigation Arrow Left -->
    {#if !isCompareMode || hasCompareQueue}
      <button
        class="nav-arrow left"
        onclick={isCompareMode ? navigateComparePrev : navigatePrev}
        disabled={isCompareMode ? compareIndexValue === 0 : currentIndex === 0}
        aria-label="Previous image"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
    {/if}

    <!-- Image Container -->
    <div
      class="image-container"
      class:dragging={isDragging}
      class:column-mode={useColumnMode}
      bind:this={imageContainer}
      onwheel={handleWheel}
      onmousedown={handleMouseDown}
      onscroll={handleScroll}
      role="presentation"
    >
      {#if isCompareMode || currentImage}
        {#if useColumnMode}
          <div class="column-scroll-spacer" style="height: {columnScrollHeight}px"></div>
          <div class="column-grid" style="width: {Math.max(0, (columnWidth + COLUMN_GAP) * effectiveColumns - COLUMN_GAP)}px; gap: {COLUMN_GAP}px;">
            {#each columnIndexes as idx}
              <div class="column" style="width: {columnWidth}px; height: {columnSegmentHeight}px;">
                <div
                  class="column-image"
                  style="background-image: url('{baseImageSrc}'); background-size: {columnWidth}px {scaledHeight}px; background-position: 0 {-getColumnOffset(idx)}px;"
                ></div>
                {#if overlayImageSrc}
                  <div
                    class="column-overlay"
                    style="background-image: url('{overlayImageSrc}'); background-size: {columnWidth}px {scaledHeight}px; background-position: 0 {-getColumnOffset(idx)}px; opacity: {diffOpacity / 100};"
                  ></div>
                {/if}
              </div>
            {/each}
          </div>
          <img
            class="hidden-image"
            src={baseImageSrc}
            alt={isCompareMode ? displayTitle : currentImage?.filename}
            onload={handleImageLoad}
          />
        {:else}
          <div class="image-stack" style="width: {zoom * 100}%">
            <img
              src={baseImageSrc}
              alt={isCompareMode ? displayTitle : currentImage?.filename}
              onload={handleImageLoad}
            />
            {#if overlayImageSrc}
              <img
                class="img-overlay"
                src={overlayImageSrc}
                alt="Diff overlay"
                style="opacity: {diffOpacity / 100}"
              />
            {/if}
          </div>
        {/if}
      {/if}
    </div>

    <!-- Navigation Arrow Right -->
    {#if !isCompareMode || hasCompareQueue}
      <button
        class="nav-arrow right"
        onclick={isCompareMode ? navigateCompareNext : navigateNext}
        disabled={isCompareMode ? compareIndexValue === compareQueue.length - 1 : currentIndex === queue.length - 1}
        aria-label="Next image"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    {/if}
  </div>

  <!-- Thumbnail Strip (queue mode only) -->
  {#if showThumbnails && !isCompareMode && getImageUrl}
    <div class="thumbnail-strip">
      {#each queue as item, index (item.filename)}
        <button
          class="thumbnail"
          class:active={index === currentIndex}
          onclick={() => navigateTo(index)}
          title={item.filename}
        >
          <img
            src={getImageUrl('test', item.filename)}
            alt={item.filename}
            loading="lazy"
          />
          <span class="thumb-status" style="background: {getStatusColor(item.status)}"></span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Bottom Action Bar -->
  <FullscreenGalleryFooter
    {isCompareMode}
    {queue}
    {currentImage}
    {canAct}
    onApprove={() => handleApprove()}
    onReject={() => handleReject()}
    {onRerun}
    {testRunning}
    {onAnalyze}
    {analyzing}
    isAccepted={effectiveIsAccepted}
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
  }

  /* Header */
  .gallery-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    background: #1a1a2e;
    border-bottom: 1px solid var(--border);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }

  .position-indicator {
    font-size: 14px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .compare-count {
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text-strong);
    font-size: 12px;
  }

  .filename {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .compare-badge {
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border: 1px solid var(--border);
    background: var(--panel-strong);
    color: var(--text-muted);
  }

  .compare-badge.tone-approved {
    border-color: rgba(34, 197, 94, 0.4);
    background: rgba(34, 197, 94, 0.12);
    color: #22c55e;
  }

  .compare-badge.tone-smart {
    border-color: rgba(20, 184, 166, 0.4);
    background: rgba(20, 184, 166, 0.12);
    color: #14b8a6;
  }

  .compare-badge.tone-passed {
    border-color: rgba(56, 189, 248, 0.4);
    background: rgba(56, 189, 248, 0.12);
    color: #38bdf8;
  }

  .compare-badge.tone-diff {
    border-color: rgba(249, 115, 22, 0.4);
    background: rgba(249, 115, 22, 0.12);
    color: #f97316;
  }

  .compare-badge.tone-unapproved,
  .compare-badge.tone-issue {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.12);
    color: #ef4444;
  }

  .status-badge {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-strong);
  }

  .confidence-badge {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
  }

  .confidence-badge.pass {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .confidence-badge.warn {
    background: rgba(249, 115, 22, 0.2);
    color: #fb923c;
    border: 1px solid rgba(249, 115, 22, 0.3);
  }

  .confidence-badge.fail {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .metrics-display.compact {
    display: flex;
    gap: 12px;
    padding: 4px 10px;
    background: var(--border);
    border-radius: 4px;
  }

  .dims-display {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 10px;
    background: #2a2a3e;
    border-radius: 4px;
    font-size: 12px;
  }

  .dim-item {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .dim-label {
    color: var(--text-muted);
    font-weight: 500;
  }

  .dim-value {
    color: var(--text-muted);
    font-family: monospace;
  }

  .dim-mismatch {
    color: #f59e0b;
    font-weight: 700;
    font-size: 14px;
  }

  .opacity-control {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    background: var(--border);
    border-radius: 4px;
    margin-left: 8px;
  }

  .opacity-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .opacity-slider {
    width: 80px;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border-soft);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  .opacity-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }

  .opacity-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: none;
  }

  .opacity-value {
    font-size: 12px;
    color: var(--text-muted);
    min-width: 36px;
  }

  .header-center {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .view-tabs {
    display: flex;
    gap: 6px;
  }

  .view-tab {
    padding: 8px 16px;
    background: transparent;
    border: 2px solid var(--border-soft);
    color: var(--text-muted);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: all 0.15s;
  }

  .view-tab:hover:not(:disabled) {
    border-color: var(--text-muted);
    color: var(--text-strong);
  }

  .view-tab.active {
    background: #3b82f6;
    border-color: #3b82f6;
    color: var(--text-strong);
  }

  .view-tab.disabled,
  .view-tab:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .view-tab kbd {
    display: inline-block;
    padding: 2px 5px;
    margin-left: 6px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    font-size: 10px;
  }

  .zoom-controls {
    display: flex;
    gap: 4px;
    align-items: center;
    background: var(--border);
    padding: 4px 8px;
    border-radius: 4px;
  }

  .column-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
  }

  .column-controls select {
    background: var(--border-soft);
    border: 1px solid var(--border);
    color: var(--text-strong);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
  }

  .fit-columns-btn {
    background: var(--border-soft);
    border: 1px solid var(--border);
    color: var(--text-strong);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

  .fit-columns-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .fit-columns-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    box-shadow: 0 0 0 1px rgba(120, 200, 255, 0.35);
  }

  .zoom-btn {
    padding: 6px 10px;
    background: var(--border-soft);
    border: none;
    color: var(--text-strong);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s;
  }

  .zoom-btn:hover {
    background: var(--border-soft);
  }

  .zoom-level {
    color: var(--text-muted);
    font-size: 12px;
    min-width: 45px;
    text-align: center;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .thumbnail-toggle {
    padding: 8px 14px;
    background: var(--border);
    border: none;
    color: var(--text-muted);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s;
  }

  .thumbnail-toggle:hover {
    background: var(--border-soft);
    color: var(--text-strong);
  }

  .thumbnail-toggle.active {
    background: var(--accent);
    color: var(--text-strong);
  }

  .thumbnail-toggle kbd {
    display: inline-block;
    padding: 2px 5px;
    margin-left: 6px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    font-size: 10px;
  }

  .close-btn {
    padding: 8px 14px;
    background: #ef4444;
    border: none;
    color: var(--text-strong);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.15s;
  }

  .close-btn:hover {
    background: #dc2626;
  }

  .close-btn kbd {
    display: inline-block;
    padding: 2px 5px;
    margin-left: 6px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    font-size: 10px;
  }

  /* Main Image Area */
  .gallery-main {
    flex: 1;
    display: flex;
    align-items: stretch;
    position: relative;
    min-height: 0;
  }

  .gallery-main.with-thumbnails {
    padding-bottom: 0;
  }

  .nav-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 50px;
    height: 80px;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    color: var(--text-strong);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
    z-index: 10;
  }

  .nav-arrow.left {
    left: 0;
    border-radius: 0 8px 8px 0;
  }

  .nav-arrow.right {
    right: 0;
    border-radius: 8px 0 0 8px;
  }

  .nav-arrow:hover:not(:disabled) {
    background: rgba(99, 102, 241, 0.8);
  }

  .nav-arrow:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .nav-arrow svg {
    width: 28px;
    height: 28px;
  }

  .image-container {
    flex: 1;
    overflow: auto;
    cursor: grab;
    display: flex;
    justify-content: center;
    padding: 20px 70px;
    position: relative;
  }

  .image-container.dragging {
    cursor: grabbing;
    user-select: none;
  }

  .image-stack {
    position: relative;
    transition: width 0.1s ease-out;
  }

  .image-stack img {
    width: 100%;
    height: auto;
    display: block;
  }

  .img-overlay {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  .hidden-image {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
  }

  .image-container.column-mode {
    align-items: flex-start;
    padding: 20px;
  }

  .column-scroll-spacer {
    width: 1px;
  }

  .column-grid {
    position: sticky;
    top: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    margin: 0 auto;
  }

  .column {
    position: relative;
    background: #0a0a0a;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .column-image,
  .column-overlay {
    position: absolute;
    inset: 0;
    background-repeat: no-repeat;
  }

  .column-overlay {
    pointer-events: none;
  }

  /* Thumbnail Strip */
  .thumbnail-strip {
    display: flex;
    gap: 8px;
    padding: 12px 20px;
    background: #1a1a2e;
    border-top: 1px solid var(--border);
    overflow-x: auto;
    overflow-y: hidden;
  }

  .thumbnail {
    position: relative;
    flex-shrink: 0;
    width: 80px;
    height: 60px;
    background: #0a0a0a;
    border: 2px solid var(--border);
    border-radius: 4px;
    overflow: hidden;
    cursor: pointer;
    transition: all 0.15s;
    padding: 0;
  }

  .thumbnail:hover {
    border-color: var(--text-muted);
  }

  .thumbnail.active {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.3);
  }

  .thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-status {
    position: absolute;
    bottom: 2px;
    right: 2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid rgba(0, 0, 0, 0.5);
  }

  /* Compare mode specific styles */
  .metrics-display {
    display: flex;
    gap: 16px;
    padding: 4px 12px;
    background: var(--border);
    border-radius: 4px;
  }

  .metric {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .metric-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .metric-value {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .threshold-control {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .threshold-label {
    font-size: 13px;
    color: var(--text-muted);
  }

  .threshold-slider {
    width: 100px;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border);
    border-radius: 3px;
    outline: none;
    cursor: pointer;
  }

  .threshold-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    transition: background 0.15s;
  }

  .threshold-slider::-webkit-slider-thumb:hover {
    background: var(--accent-strong);
  }

  .threshold-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: none;
  }

  .threshold-input {
    width: 60px;
    padding: 6px 8px;
    background: var(--border);
    border: 1px solid var(--border-soft);
    border-radius: 4px;
    color: var(--text-strong);
    font-size: 13px;
    text-align: center;
  }

  .threshold-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .action-btn.recompare {
    background: var(--border);
    border: 1px solid var(--accent);
    color: var(--accent);
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn.recompare:hover:not(:disabled) {
    background: var(--accent);
    color: var(--text-strong);
  }

</style>

<script lang="ts">
  import type { GalleryImage } from './gallery-types.js';

  interface Props {
    isCompareMode: boolean;
    hasCompareQueue: boolean;
    currentImage: GalleryImage | undefined;
    currentIndex: number;
    queueLength: number;
    compareIndexValue: number;
    compareQueueLength: number;
    showThumbnails: boolean;
    isDragging: boolean;
    useColumnMode: boolean;
    centerImage: boolean;
    baseImageSrc: string;
    overlayImageSrc: string | null;
    displayTitle: string;
    zoom: number;
    diffOpacity: number;
    columnWidth: number;
    scaledHeight: number;
    columnSegmentHeight: number;
    columnScrollHeight: number;
    effectiveColumns: number;
    columnIndexes: number[];
    getColumnOffset: (index: number) => number;
    onNavigatePrev: () => void;
    onNavigateNext: () => void;
    onWheel: (e: WheelEvent) => void;
    onMouseDown: (e: MouseEvent) => void;
    onScroll: () => void;
    onImageLoad: (e: Event) => void;
    onContainerReady: (el: HTMLDivElement) => void;
  }

  const COLUMN_GAP = 16;

  let {
    isCompareMode,
    hasCompareQueue,
    currentImage,
    currentIndex,
    queueLength,
    compareIndexValue,
    compareQueueLength,
    showThumbnails,
    isDragging,
    useColumnMode,
    centerImage,
    baseImageSrc,
    overlayImageSrc,
    displayTitle,
    zoom,
    diffOpacity,
    columnWidth,
    scaledHeight,
    columnSegmentHeight,
    columnScrollHeight,
    effectiveColumns,
    columnIndexes,
    getColumnOffset,
    onNavigatePrev,
    onNavigateNext,
    onWheel,
    onMouseDown,
    onScroll,
    onImageLoad,
    onContainerReady,
  }: Props = $props();

  let imageContainer: HTMLDivElement | undefined = $state();

  $effect(() => {
    if (imageContainer) {
      onContainerReady(imageContainer);
    }
  });
</script>

<div class="gallery-main" class:with-thumbnails={showThumbnails && !isCompareMode}>
  <!-- Navigation Arrow Left -->
  {#if !isCompareMode || hasCompareQueue}
    <button
      class="nav-arrow left"
      onclick={onNavigatePrev}
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
    class:centered={centerImage}
    bind:this={imageContainer}
    onwheel={onWheel}
    onmousedown={onMouseDown}
    onscroll={onScroll}
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
          onload={onImageLoad}
        />
      {:else}
        <div class="image-stack" style="width: {zoom * 100}%">
          <img
            src={baseImageSrc}
            alt={isCompareMode ? displayTitle : currentImage?.filename}
            onload={onImageLoad}
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
      onclick={onNavigateNext}
      disabled={isCompareMode ? compareIndexValue === compareQueueLength - 1 : currentIndex === queueLength - 1}
      aria-label="Next image"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  {/if}
</div>

<style>
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
    border-radius: 0;
  }

  .nav-arrow.right {
    right: 0;
    border-radius: 0;
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
    justify-content: flex-start;
    padding: 20px 70px;
    position: relative;
  }

  .image-container.dragging {
    cursor: grabbing;
    user-select: none;
  }

  .image-container.centered {
    justify-content: center;
  }

  .image-stack {
    position: relative;
    transition: width 0.1s ease-out;
    flex: 0 0 auto;
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
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0;
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
</style>

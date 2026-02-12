<script lang="ts">
  import type { GalleryImage, ImageStatus } from './gallery-types.js';

  interface Props {
    queue: GalleryImage[];
    currentIndex: number;
    getImageUrl: (type: 'baseline' | 'test' | 'diff', filename: string) => string;
    onNavigateTo: (index: number) => void;
  }

  let {
    queue,
    currentIndex,
    getImageUrl,
    onNavigateTo,
  }: Props = $props();

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
</script>

<div class="thumbnail-strip">
  {#each queue as item, index (item.filename)}
    <button
      class="thumbnail"
      class:active={index === currentIndex}
      onclick={() => onNavigateTo(index)}
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

<style>
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
    border-radius: 0;
    font-family: var(--font-mono, monospace);
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
    border-radius: 0;
    border: 1px solid rgba(0, 0, 0, 0.5);
  }
</style>

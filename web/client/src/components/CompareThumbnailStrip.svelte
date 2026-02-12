<script lang="ts">
  import type { CompareQueueItem } from './gallery-types.js';

  interface Props {
    queue: CompareQueueItem[];
    currentIndex: number;
    onNavigateTo: (index: number) => void;
  }

  let { queue, currentIndex, onNavigateTo }: Props = $props();

  function getThumbSrc(item: CompareQueueItem): string {
    return item.images.diff?.src || item.images.right.src || item.images.left.src;
  }
</script>

<div class="thumb-strip" aria-label="Compare thumbnails">
  {#each queue as item, i}
    <button
      type="button"
      class="thumb"
      class:active={i === currentIndex}
      class:accepted={!!item.accepted}
      onclick={() => onNavigateTo(i)}
      title={item.title}
    >
      <img src={getThumbSrc(item)} alt={item.title} loading="lazy" />
      <span class="meta">
        <span class="title">{item.title}</span>
      </span>
    </button>
  {/each}
</div>

<style>
  .thumb-strip {
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    overflow-x: auto;
    border-top: 1px solid var(--border);
    background: rgba(10, 10, 18, 0.9);
  }

  .thumb {
    flex: 0 0 auto;
    width: 220px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 0;
    background: rgba(255, 255, 255, 0.03);
    font-family: var(--font-mono, monospace);
    cursor: pointer;
    overflow: hidden;
    text-align: left;
    transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
  }

  .thumb:hover {
    transform: translateY(-1px);
    border-color: rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.05);
  }

  .thumb.active {
    border-color: rgba(56, 189, 248, 0.6);
    box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.18) inset;
  }

  .thumb.accepted {
    border-color: rgba(34, 197, 94, 0.55);
  }

  .thumb img {
    width: 100%;
    height: 110px;
    object-fit: cover;
    display: block;
    background: rgba(0, 0, 0, 0.25);
  }

  .meta {
    display: block;
    padding: 8px 10px;
  }

  .title {
    display: block;
    font-size: 12px;
    line-height: 1.2;
    color: rgba(255, 255, 255, 0.78);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>


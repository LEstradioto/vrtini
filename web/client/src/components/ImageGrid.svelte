<script lang="ts">
  import type { ImageMetadata } from '../lib/api';

  type ImageStatus = 'passed' | 'failed' | 'new';
  type ImageTag = 'all' | 'passed' | 'failed' | 'new' | 'approved' | 'unapproved' | 'diff' | 'auto-review';

  let {
    currentList,
    fullList,
    rawList,
    totalPages,
    currentPage = $bindable(),
    searchQuery = $bindable(),
    tagFilter = $bindable(),
    selectedImages = $bindable(),
    currentImageType,
    autoThresholdReviewCount,
    activeTab,
    testState,
    getImageUrl,
    getImageStatus,
    getTagFor,
    isTagActive,
    toggleTagFilter,
    matchesTagSet,
    metadataMap,
    onOpenGallery,
    onBulkRerun,
  } = $props<{
    currentList: string[];
    fullList: string[];
    rawList: string[];
    totalPages: number;
    currentPage: number;
    searchQuery: string;
    tagFilter: Set<ImageTag>;
    selectedImages: Set<string>;
    currentImageType: 'baseline' | 'test' | 'diff';
    autoThresholdReviewCount: number;
    activeTab: string;
    testState: unknown;
    getImageUrl: (type: 'baseline' | 'test' | 'diff', filename: string) => string;
    getImageStatus: (filename: string) => ImageStatus | null;
    getTagFor: (filename: string) => ImageTag;
    isTagActive: (tag: ImageTag) => boolean;
    toggleTagFilter: (tag: ImageTag, event?: MouseEvent) => void;
    matchesTagSet: (filename: string, tags: Set<ImageTag>) => boolean;
    metadataMap: Map<string, ImageMetadata>;
    onOpenGallery: (filename: string) => void;
    onBulkRerun: () => void;
  }>();

  let debouncedSearchQuery = $state('');
  let loadedImages = $state<Set<string>>(new Set());
  let lastSelectedIndex = $state<number | null>(null);

  const SEARCH_DEBOUNCE_MS = 200;

  function formatUpdatedAt(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
  }

  function getTagLabel(tag: ImageTag): string {
    switch (tag) {
      case 'approved': return 'Approved';
      case 'unapproved': return 'Unapproved';
      case 'new': return 'New';
      case 'passed': return 'Passed';
      case 'diff': return 'Diff';
      case 'auto-review': return 'Auto Review';
      default: return 'All';
    }
  }

  function onImageLoad(filename: string) {
    loadedImages.add(filename);
    loadedImages = new Set(loadedImages);
  }

  function isSelected(filename: string): boolean {
    return selectedImages.has(filename);
  }

  function toggleImageSelection(filename: string, index: number, event: MouseEvent) {
    const newSelected = new Set(selectedImages);
    if (event.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      for (let i = start; i <= end; i++) {
        newSelected.add(currentList[i]);
      }
    } else {
      if (newSelected.has(filename)) { newSelected.delete(filename); } else { newSelected.add(filename); }
    }
    selectedImages = newSelected;
    lastSelectedIndex = index;
  }

  let allPageSelected = $derived(currentList.length > 0 && currentList.every((f) => selectedImages.has(f)));
  let allFilteredSelected = $derived(fullList.length > 0 && fullList.every((f) => selectedImages.has(f)));
  let selectedCount = $derived(selectedImages.size);

  function selectAll() {
    if (allFilteredSelected) return;
    if (allPageSelected && totalPages > 1) {
      selectedImages = new Set(fullList);
    } else {
      selectedImages = new Set(currentList);
    }
  }

  let selectAllLabel = $derived.by(() => {
    if (allFilteredSelected) return `All (${fullList.length})`;
    if (allPageSelected && totalPages > 1) return `All Pages (${fullList.length})`;
    return 'Select All';
  });

  function deselectAll() {
    selectedImages = new Set();
    lastSelectedIndex = null;
  }

  // Debounce search
  $effect(() => {
    const query = searchQuery;
    if (!query.trim()) { debouncedSearchQuery = ''; return; }
    const handle = setTimeout(() => { debouncedSearchQuery = query; }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  });
</script>

<div class="image-panel">
  <div class="search-bar">
    <input type="text" class="search-input" placeholder="Filter images..." bind:value={searchQuery} />
    {#if searchQuery}
      <button class="clear-btn" onclick={() => searchQuery = ''}>x</button>
    {/if}
    <span class="result-count">{fullList.length} of {rawList.length} images</span>
    <div class="tag-filters" title="Cmd/Ctrl-click to multi-select">
      <button class="tag-filter tag-all" class:active={isTagActive('all')} onclick={(event) => toggleTagFilter('all', event)} title="Show all images">All</button>
      <button class="tag-filter tag-passed" class:active={isTagActive('passed')} onclick={(event) => toggleTagFilter('passed', event)} title="Baseline matches test">Passed</button>
      <button class="tag-filter tag-new" class:active={isTagActive('new')} onclick={(event) => toggleTagFilter('new', event)} title="Test exists without baseline">New</button>
      <button class="tag-filter tag-unapproved" class:active={isTagActive('unapproved')} onclick={(event) => toggleTagFilter('unapproved', event)} title="Diffs or new items not approved">Unapproved</button>
      <button class="tag-filter tag-approved" class:active={isTagActive('approved')} onclick={(event) => toggleTagFilter('approved', event)} title="Items you have approved">Approved</button>
      <button class="tag-filter tag-diff" class:active={isTagActive('diff')} onclick={(event) => toggleTagFilter('diff', event)} title="Images with visual diffs">Diff</button>
      {#if activeTab === 'diffs' && autoThresholdReviewCount > 0}
        <button class="tag-filter tag-auto-review" class:active={isTagActive('auto-review')} onclick={(event) => toggleTagFilter('auto-review', event)} title="Diffs requiring auto-threshold review">
          Auto Review ({autoThresholdReviewCount})
        </button>
      {/if}
    </div>
    <div class="selection-controls">
      <button class="btn small" class:expanded={allPageSelected && !allFilteredSelected && totalPages > 1} class:all-selected={allFilteredSelected} onclick={selectAll}>{selectAllLabel}</button>
      <button class="btn small" onclick={deselectAll} disabled={selectedCount === 0}>Deselect</button>
      {#if selectedCount > 0}
        <span class="selected-count">{selectedCount} selected</span>
        <button class="btn small rerun" onclick={onBulkRerun} disabled={!!testState}>
          {testState ? 'Running...' : `Rerun (${selectedCount})`}
        </button>
      {/if}
    </div>
  </div>

  {#if fullList.length === 0}
    <div class="empty">
      {#if debouncedSearchQuery}
        No images match "{debouncedSearchQuery}"
      {:else}
        No images in this folder
      {/if}
    </div>
  {:else}
    {#if totalPages > 1}
      <div class="pagination">
        <button class="btn small" onclick={() => currentPage = Math.max(0, currentPage - 1)} disabled={currentPage === 0}>Prev</button>
        <span class="page-info">Page {currentPage + 1} of {totalPages} ({fullList.length} images)</span>
        <button class="btn small" onclick={() => currentPage = Math.min(totalPages - 1, currentPage + 1)} disabled={currentPage >= totalPages - 1}>Next</button>
      </div>
    {:else}
      <div class="image-count">{fullList.length} images</div>
    {/if}

    <div class="image-grid">
      {#each currentList as filename, index (filename)}
        {@const status = getImageStatus(filename)}
        {@const checked = isSelected(filename)}
        {@const meta = metadataMap.get(filename)}
        {@const tag = getTagFor(filename)}
        <div
          class="image-card"
          class:multi-selected={checked}
          class:tag-approved={tag === 'approved'}
          class:tag-unapproved={tag === 'unapproved'}
          class:tag-new={tag === 'new'}
          class:tag-passed={tag === 'passed'}
          class:tag-diff={tag === 'diff'}
          class:tag-auto-review={tag === 'auto-review'}
          onclick={() => onOpenGallery(filename)}
          onkeydown={(e) => e.key === 'Enter' && onOpenGallery(filename)}
          role="button"
          tabindex="0"
        >
          <div class="image-card-header">
            <div class="image-card-title">
              <div class="image-title" title={meta?.scenario || filename}>{meta?.scenario || filename}</div>
              <div class="image-meta">
                {#if meta}
                  {meta.browser}{meta.version ? ` v${meta.version}` : ''} · {meta.viewport}
                  {#if meta.updatedAt}
                    <span class="image-updated"> · Updated {formatUpdatedAt(meta.updatedAt)}</span>
                  {/if}
                {:else}
                  {currentImageType}
                {/if}
              </div>
            </div>
            <div class="image-tag tag-{tag}">{getTagLabel(tag)}</div>
          </div>
          <div class="image-thumb">
            <label class="checkbox-wrapper" class:visible={checked} onclick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={checked} onclick={(e) => toggleImageSelection(filename, index, e)} />
              <span class="checkmark"></span>
            </label>
            {#if !loadedImages.has(filename)}
              <div class="image-placeholder"></div>
            {/if}
            <img
              src={getImageUrl(currentImageType, filename)}
              alt={filename}
              loading="lazy"
              onload={() => onImageLoad(filename)}
              class:loaded={loadedImages.has(filename)}
            />
          </div>
          <div class="image-name" title={filename}>{filename}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .image-panel {
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .search-bar .search-input {
    flex: 1;
    min-width: 220px;
    padding: 0.5rem 0.75rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-strong);
    font-size: 0.875rem;
  }
  .search-bar .search-input:focus { outline: none; border-color: var(--accent); }
  .search-bar .search-input::placeholder { color: var(--text-muted); }
  .search-bar .clear-btn { background: none; border: none; color: var(--text-muted); font-size: 1.25rem; cursor: pointer; padding: 0 0.25rem; line-height: 1; }
  .search-bar .clear-btn:hover { color: var(--text-strong); }
  .search-bar .result-count { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; }

  .tag-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }

  .tag-filter {
    padding: 0.28rem 0.6rem;
    border-radius: 999px;
    border: 1px solid transparent;
    background: var(--panel-strong);
    color: var(--text-muted);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    opacity: 0.55;
    transition: opacity 0.15s, border-color 0.15s, color 0.15s, background 0.15s;
  }
  .tag-filter.active { opacity: 1; color: var(--text-strong); }
  .tag-filter.tag-approved { border-color: rgba(34, 197, 94, 0.4); background: rgba(34, 197, 94, 0.12); color: var(--tag-approved); }
  .tag-filter.tag-unapproved { border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.12); color: var(--tag-unapproved); }
  .tag-filter.tag-new { border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.12); color: var(--tag-new); }
  .tag-filter.tag-diff { border-color: rgba(249, 115, 22, 0.45); background: rgba(249, 115, 22, 0.12); color: var(--tag-diff); }
  .tag-filter.tag-auto-review { border-color: rgba(234, 179, 8, 0.45); background: rgba(234, 179, 8, 0.12); color: var(--tag-auto-review); }
  .tag-filter.tag-passed { border-color: rgba(56, 189, 248, 0.45); background: rgba(56, 189, 248, 0.12); color: var(--tag-passed); }

  .selection-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
    padding-left: 1rem;
    border-left: 1px solid var(--border);
  }

  .selected-count { font-size: 0.8rem; color: var(--accent); font-weight: 500; }

  .btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.5rem 1rem; border: none; border-radius: 6px; background: var(--border); color: var(--text-strong); font-size: 0.875rem; cursor: pointer; transition: background 0.2s; }
  .btn:hover { background: var(--border-soft); }
  .btn.small { padding: 0.375rem 0.75rem; font-size: 0.8rem; }
  .btn.small.expanded { background: var(--accent); color: #fff; }
  .btn.small.all-selected { background: #22c55e; color: #fff; }
  .btn.small.rerun { background: transparent; border: 1px solid var(--accent); color: var(--accent); }
  .btn.small.rerun:hover:not(:disabled) { background: var(--accent); color: #fff; }

  .empty {
    text-align: center;
    padding: 3rem;
    color: var(--text-muted);
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 0.75rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .page-info { font-size: 0.8rem; color: var(--text-muted); }

  .image-count {
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }

  .image-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.75rem;
    padding: 0.75rem;
    overflow-y: auto;
    align-content: start;
    flex: 1;
  }

  .image-card {
    background: var(--panel-soft);
    border: 2px solid var(--border-soft);
    border-radius: 12px;
    padding: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    cursor: pointer;
    transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
    contain: layout style paint;
    content-visibility: auto;
    contain-intrinsic-size: auto 220px auto 210px;
  }
  .image-card:hover { border-color: var(--text-muted); transform: translateY(-2px); }
  .image-card.multi-selected { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15); }
  .image-card.tag-approved { border-color: rgba(34, 197, 94, 0.6); }
  .image-card.tag-unapproved { border-color: rgba(239, 68, 68, 0.6); }
  .image-card.tag-new { border-color: rgba(245, 158, 11, 0.7); }
  .image-card.tag-diff { border-color: rgba(249, 115, 22, 0.7); }
  .image-card.tag-auto-review { border-color: rgba(234, 179, 8, 0.7); }
  .image-card.tag-passed { border-color: rgba(56, 189, 248, 0.7); }

  .image-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; }
  .image-card-title { min-width: 0; }
  .image-title { font-size: 0.85rem; font-weight: 600; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .image-meta { font-size: 0.7rem; color: var(--text-muted); margin-top: 0.15rem; }

  .image-tag {
    font-size: 0.6rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
    padding: 0.18rem 0.5rem; border-radius: 999px; border: 1px solid var(--border);
    background: var(--panel-strong); color: var(--text-muted); white-space: nowrap;
  }
  .image-tag.tag-approved { border-color: rgba(34, 197, 94, 0.4); background: rgba(34, 197, 94, 0.12); color: var(--tag-approved); }
  .image-tag.tag-unapproved { border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.12); color: var(--tag-unapproved); }
  .image-tag.tag-new { border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.12); color: var(--tag-new); }
  .image-tag.tag-diff { border-color: rgba(249, 115, 22, 0.45); background: rgba(249, 115, 22, 0.12); color: var(--tag-diff); }
  .image-tag.tag-auto-review { border-color: rgba(234, 179, 8, 0.45); background: rgba(234, 179, 8, 0.12); color: var(--tag-auto-review); }
  .image-tag.tag-passed { border-color: rgba(56, 189, 248, 0.45); background: rgba(56, 189, 248, 0.12); color: var(--tag-passed); }

  .image-thumb {
    position: relative; height: 120px; background: var(--panel-strong);
    border: 1px solid var(--border); border-radius: 8px; overflow: hidden;
  }

  .checkbox-wrapper {
    position: absolute; top: 6px; left: 6px; z-index: 2;
    opacity: 0; transition: opacity 0.15s;
  }
  .checkbox-wrapper.visible, .image-card:hover .checkbox-wrapper { opacity: 1; }
  .checkbox-wrapper input { position: absolute; opacity: 0; cursor: pointer; height: 0; width: 0; }
  .checkmark {
    display: block; width: 18px; height: 18px; background: rgba(0, 0, 0, 0.6);
    border: 2px solid var(--text-muted); border-radius: 4px; cursor: pointer;
    transition: all 0.15s;
  }
  .checkbox-wrapper:hover .checkmark { border-color: var(--accent); }
  .checkbox-wrapper input:checked ~ .checkmark { background: var(--accent); border-color: var(--accent); }
  .checkbox-wrapper input:checked ~ .checkmark::after {
    content: ''; position: absolute; left: 6px; top: 2px;
    width: 4px; height: 8px; border: solid var(--text-strong);
    border-width: 0 2px 2px 0; transform: rotate(45deg);
  }

  .image-placeholder {
    position: absolute; inset: 0;
    background: linear-gradient(135deg, var(--panel) 25%, var(--panel-soft) 50%, var(--panel) 75%);
    background-size: 200% 200%;
    animation: shimmer 1.5s infinite;
  }
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .image-thumb img { width: 100%; height: 100%; object-fit: contain; opacity: 0; transition: opacity 0.2s; }
  .image-thumb img.loaded { opacity: 1; }

  .image-name {
    padding: 0.25rem 0.35rem 0.1rem; font-size: 0.65rem; color: var(--text-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-top: 1px solid transparent;
  }

  @media (max-width: 768px) {
    .selection-controls { display: none; }
  }
</style>

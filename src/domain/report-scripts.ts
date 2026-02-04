/**
 * JavaScript for the VRT HTML report (client-side interactivity).
 */

export const reportScripts = `
    const approvals = new Set();
    let currentImages = [];
    let currentIdx = 0;
    let currentResultName = '';
    let currentFilter = 'all';
    let diffOpacity = 70;
    let zoom = 1;
    const ZOOM_STEP = 0.05;
    const MIN_ZOOM = 0.05;
    const MAX_ZOOM = 4;
    const overlay = document.getElementById('overlay');
    const overlayTitle = document.getElementById('overlay-title');
    const overlayContent = document.getElementById('overlay-content');
    const overlayImg = document.getElementById('overlay-img');
    const overlayImgTop = document.getElementById('overlay-img-top');
    const opacityControls = document.getElementById('opacity-controls');
    const opacityValue = document.getElementById('opacity-value');
    const zoomLevel = document.getElementById('zoom-level');

    // Drag-to-pan state
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let scrollStartX = 0;
    let scrollStartY = 0;

    function approveFromElement(actionEl) {
      const el = actionEl.closest('.result');
      if (!el) return;
      const name = el.dataset.name || '';

      el.classList.add('approved');
      const approveBtn = el.querySelector('.approve-btn');
      if (approveBtn) approveBtn.disabled = true;
      approvals.add(name);

      const data = {
        name,
        test: el.dataset.test,
        baseline: el.dataset.baseline
      };

      const stored = JSON.parse(localStorage.getItem('vrt-approvals') || '[]');
      stored.push(data);
      localStorage.setItem('vrt-approvals', JSON.stringify(stored));

      console.log('Approved:', name);
    }

    function filter(type, buttonEl) {
      currentFilter = type;
      document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
      if (buttonEl) buttonEl.classList.add('active');

      document.querySelectorAll('.result').forEach(el => {
        let show = false;
        if (type === 'all') {
          show = true;
        } else if (type === 'approved') {
          show = el.classList.contains('approved');
        } else if (type === 'smart-pass') {
          show = el.classList.contains('smart-pass');
        } else if (type === 'auto-approved') {
          show = el.dataset.autoAction === 'approve';
        } else if (type === 'needs-review') {
          show = el.classList.contains('failed') && !el.classList.contains('approved') && el.dataset.autoAction !== 'approve';
        } else {
          if (type === 'failed') {
            show = el.classList.contains('failed') && !el.classList.contains('approved');
          } else {
            show = el.classList.contains(type);
          }
        }
        el.style.display = show ? '' : 'none';
      });
    }

    function getVisibleResults() {
      return Array.from(document.querySelectorAll('.result')).filter(el => el.style.display !== 'none');
    }

    function navigateResult(direction) {
      const visible = getVisibleResults();
      if (visible.length === 0) return;

      const currentIndex = visible.findIndex(el => el.dataset.name === currentResultName);
      let newIndex = currentIndex + direction;

      if (newIndex < 0) newIndex = visible.length - 1;
      if (newIndex >= visible.length) newIndex = 0;

      const newResult = visible[newIndex];
      if (newResult) {
        openCompareFromElement(newResult, currentIdx);
      }
    }

    function updateOpacity(value) {
      diffOpacity = parseInt(value);
      opacityValue.textContent = diffOpacity + '%';
      overlayImgTop.style.opacity = diffOpacity / 100;
    }

    function updateZoom() {
      const stack = document.querySelector('.img-stack');
      stack.style.transform = 'scale(' + zoom + ')';
      zoomLevel.textContent = Math.round(zoom * 100) + '%';
    }

    function zoomIn() {
      zoom = Math.min(MAX_ZOOM, zoom + ZOOM_STEP);
      updateZoom();
    }

    function zoomOut() {
      zoom = Math.max(MIN_ZOOM, zoom - ZOOM_STEP);
      updateZoom();
    }

    function resetZoom() {
      zoom = 1;
      updateZoom();
      overlayContent.scrollTo(0, 0);
    }

    function openCompareFromElement(result, startIdx = 0) {
      if (!result) return;
      const imgs = result.querySelectorAll('.images img');
      currentImages = Array.from(imgs).map(img => img.src);
      currentIdx = startIdx;
      currentResultName = result.dataset.name || '';
      zoom = 1;

      overlayTitle.textContent = currentResultName;
      overlay.classList.add('active');
      showImage(currentIdx);
      updateZoom();
      document.body.style.overflow = 'hidden';
    }

    function openCompareByName(name, startIdx = 0) {
      const result = Array.from(document.querySelectorAll('.result')).find(el => el.dataset.name === name);
      if (!result) return;
      openCompareFromElement(result, startIdx);
    }

    function closeOverlay() {
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }

    function showImage(idx) {
      if (idx < 0 || idx > 2) return;

      currentIdx = idx;

      // Diff mode (idx 1): show baseline with diff on top, opacity controlled
      if (idx === 1 && currentImages[0] && currentImages[1]) {
        overlayImg.src = currentImages[0]; // Baseline underneath
        overlayImgTop.src = currentImages[1];  // Diff on top
        overlayImgTop.style.display = 'block';
        overlayImgTop.style.opacity = diffOpacity / 100;
        opacityControls.classList.add('visible');
      } else {
        if (!currentImages[idx]) return;
        overlayImg.src = currentImages[idx];
        overlayImgTop.style.display = 'none';
        opacityControls.classList.remove('visible');
      }

      document.querySelectorAll('.overlay-tab').forEach((tab, i) => {
        tab.classList.toggle('active', i === idx);
      });
    }

    // Mouse wheel zoom (only with Ctrl key - allows normal scrolling otherwise)
    overlayContent?.addEventListener('wheel', (e) => {
      if (!overlay.classList.contains('active')) return;
      if (!e.ctrlKey) return; // Allow normal scroll when Ctrl not held
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else zoomOut();
    }, { passive: false });

    // Drag-to-pan functionality (like Figma)
    overlayContent?.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // Only left click
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      scrollStartX = overlayContent.scrollLeft;
      scrollStartY = overlayContent.scrollTop;
      overlayContent.classList.add('dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      overlayContent.scrollLeft = scrollStartX - dx;
      overlayContent.scrollTop = scrollStartY - dy;
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        overlayContent?.classList.remove('dragging');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (!overlay.classList.contains('active')) return;

      switch(e.key) {
        case 'Escape':
          closeOverlay();
          break;
        case '1':
          showImage(0);
          break;
        case '2':
          showImage(1);
          break;
        case '3':
          showImage(2);
          break;
        case 'ArrowLeft':
          navigateResult(-1);
          break;
        case 'ArrowRight':
          navigateResult(1);
          break;
        case '+':
        case '=':
          zoomIn();
          break;
        case '-':
          zoomOut();
          break;
        case '0':
          resetZoom();
          break;
      }
    });

    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const actionEl = target.closest('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;

      switch(action) {
        case 'approve':
          approveFromElement(actionEl);
          break;
        case 'compare': {
          const result = actionEl.closest('.result');
          openCompareFromElement(result, 0);
          break;
        }
        case 'open-compare': {
          const idx = parseInt(actionEl.dataset.idx || '0', 10);
          const result = actionEl.closest('.result');
          openCompareFromElement(result, idx);
          break;
        }
        case 'filter':
          filter(actionEl.dataset.filter || 'all', actionEl);
          break;
        case 'overlay-tab': {
          const idx = parseInt(actionEl.dataset.idx || '0', 10);
          showImage(idx);
          break;
        }
        case 'zoom-in':
          zoomIn();
          break;
        case 'zoom-out':
          zoomOut();
          break;
        case 'zoom-reset':
          resetZoom();
          break;
        case 'overlay-close':
          closeOverlay();
          break;
      }
    });

    document.getElementById('opacity-slider')?.addEventListener('input', (e) => {
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      updateOpacity(target.value);
    });
`;

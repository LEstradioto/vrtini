/**
 * CSS styles for the VRT HTML report.
 */

export const reportStyles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; }
    .header { background: #1a1a2e; color: white; padding: 20px; }
    .header h1 { font-size: 24px; margin-bottom: 8px; }
    .header .meta { font-size: 14px; opacity: 0.8; }
    .summary { display: flex; gap: 20px; padding: 20px; background: white; border-bottom: 1px solid #ddd; }
    .summary-item { text-align: center; }
    .summary-item .count { font-size: 32px; font-weight: bold; }
    .summary-item .label { font-size: 12px; text-transform: uppercase; color: #666; }
    .summary-item.passed .count { color: #22c55e; }
    .summary-item.smart-pass .count { color: #14b8a6; }
    .summary-item.failed .count { color: #ef4444; }
    .summary-item.new .count { color: #3b82f6; }
    .summary-item.error .count { color: #f59e0b; }
    .summary-item.approved .count { color: #16a34a; }
    .results { padding: 20px; }
    .result { background: white; border-radius: 8px; margin-bottom: 20px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .result-header { display: flex; align-items: center; gap: 12px; padding: 16px; border-bottom: 1px solid #eee; flex-wrap: wrap; }
    .result-header h3 { flex: 1; font-size: 16px; min-width: 200px; }
    .status { padding: 4px 12px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .status.passed { background: #dcfce7; color: #166534; }
    .status.failed { background: #fee2e2; color: #991b1b; }
    .status.new { background: #dbeafe; color: #1e40af; }
    .status.error { background: #fef3c7; color: #92400e; }
    .status.smart-pass { background: #ccfbf1; color: #0f766e; }
    .diff-stats { font-size: 13px; font-weight: 600; padding: 4px 8px; border-radius: 4px; }
    .diff-stats.diff-high { background: #fee2e2; color: #991b1b; }
    .diff-stats.diff-medium { background: #fef3c7; color: #92400e; }
    .diff-stats.diff-low { background: #fef9c3; color: #854d0e; }
    .ssim-score { font-size: 13px; font-weight: 600; padding: 4px 8px; border-radius: 4px; margin-left: 8px; }
    .ssim-score.ssim-good { background: #dcfce7; color: #166534; }
    .ssim-score.ssim-warn { background: #fef3c7; color: #92400e; }
    .ssim-score.ssim-bad { background: #fee2e2; color: #991b1b; }
    .approve-btn, .compare-btn { padding: 6px 16px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
    .compare-btn { background: #6b7280; }
    .approve-btn:hover { background: #2563eb; }
    .compare-btn:hover { background: #4b5563; }
    .approve-btn:disabled { background: #9ca3af; cursor: not-allowed; }
    .images { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 16px; }
    .image-container { text-align: center; cursor: pointer; }
    .image-container:hover img { outline: 3px solid #3b82f6; }
    .image-container h4 { font-size: 13px; color: #666; margin-bottom: 8px; }
    .image-container img { max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px; }
    .no-image { padding: 40px; background: #f5f5f5; border-radius: 4px; color: #999; font-size: 14px; }
    .error-message { padding: 12px 16px; background: #fef2f2; color: #991b1b; font-size: 13px; }
    .observation { font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 4px; background: #fef3c7; color: #92400e; }
    .approved { opacity: 0.6; }
    .approved .status { background: #dcfce7 !important; color: #166534 !important; }
    .approved .status::after { content: ' (Approved)'; }
    .auto-approved { border-left: 4px solid #22c55e; }
    .result.smart-pass { border-left: 4px solid #14b8a6; }
    .filter-bar { padding: 12px 20px; background: white; border-bottom: 1px solid #ddd; display: flex; gap: 8px; flex-wrap: wrap; }
    .filter-btn { padding: 6px 12px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer; font-size: 13px; }
    .filter-btn.active { background: #1a1a2e; color: white; border-color: #1a1a2e; }

    /* pHash styles */
    .phash-score { font-size: 13px; font-weight: 600; padding: 4px 8px; border-radius: 4px; margin-left: 8px; }
    .phash-score.phash-good { background: #dcfce7; color: #166534; }
    .phash-score.phash-warn { background: #fef3c7; color: #92400e; }
    .phash-score.phash-bad { background: #fee2e2; color: #991b1b; }

    /* Confidence styles */
    .confidence-score { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; margin-left: 8px; padding: 4px 8px; background: #f3f4f6; border-radius: 4px; }
    .confidence-label { color: #6b7280; }
    .confidence-value { font-weight: 700; }
    .confidence-verdict { font-weight: 600; padding: 2px 6px; border-radius: 3px; font-size: 11px; text-transform: uppercase; }
    .verdict-pass { color: #166534; background: #dcfce7; }
    .verdict-fail { color: #991b1b; background: #fee2e2; }
    .verdict-review { color: #92400e; background: #fef3c7; }

    /* Auto-action badge */
    .auto-action { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; }
    .auto-action.auto-approve { background: #dcfce7; color: #166534; }
    .auto-action.auto-reject { background: #fee2e2; color: #991b1b; }
    .auto-action.auto-flag { background: #fef3c7; color: #92400e; }

    /* AI Analysis section */
    .ai-analysis { padding: 12px 16px; background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-top: 1px solid #bae6fd; }
    .ai-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
    .ai-badge { font-size: 10px; font-weight: 700; padding: 3px 8px; background: #0ea5e9; color: white; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    .ai-category { font-size: 12px; font-weight: 600; padding: 3px 8px; border-radius: 4px; }
    .ai-category.category-regression { background: #fee2e2; color: #991b1b; }
    .ai-category.category-cosmetic { background: #dcfce7; color: #166534; }
    .ai-category.category-change { background: #fef3c7; color: #92400e; }
    .ai-severity { font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 3px; text-transform: uppercase; }
    .ai-severity.severity-critical { background: #991b1b; color: white; }
    .ai-severity.severity-warning { background: #f59e0b; color: white; }
    .ai-severity.severity-info { background: #6b7280; color: white; }
    .ai-confidence { font-size: 12px; color: #475569; }
    .ai-recommendation { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; }
    .ai-recommendation.recommend-approve { background: #166534; color: white; }
    .ai-recommendation.recommend-reject { background: #991b1b; color: white; }
    .ai-recommendation.recommend-review { background: #0369a1; color: white; }
    .ai-summary { font-size: 14px; color: #334155; margin: 0 0 8px 0; line-height: 1.5; }
    .ai-details { font-size: 13px; color: #475569; }
    .ai-details summary { cursor: pointer; font-weight: 600; color: #0369a1; }
    .ai-details ul { margin: 8px 0; padding-left: 20px; }
    .ai-details li { margin: 4px 0; }
    .ai-reasoning { margin-top: 8px; font-style: italic; color: #64748b; }

    /* Fullscreen overlay */
    .overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.95); z-index: 1000; flex-direction: column; }
    .overlay.active { display: flex; }
    .overlay-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 24px; background: #1a1a2e; color: white; flex-wrap: wrap; gap: 12px; }
    .overlay-title { font-size: 18px; font-weight: 600; }
    .overlay-controls { display: flex; gap: 8px; align-items: center; }
    .overlay-tabs { display: flex; gap: 8px; }
    .overlay-tab { padding: 8px 20px; background: transparent; border: 2px solid #444; color: #aaa; border-radius: 4px; cursor: pointer; font-size: 14px; font-weight: 600; transition: all 0.15s; }
    .overlay-tab:hover { border-color: #666; color: #fff; }
    .overlay-tab.active { background: #3b82f6; border-color: #3b82f6; color: white; }
    .overlay-tab kbd { display: inline-block; padding: 2px 6px; margin-left: 6px; background: rgba(255,255,255,0.2); border-radius: 3px; font-size: 11px; }
    .opacity-controls { display: none; align-items: center; gap: 8px; background: #333; padding: 4px 12px; border-radius: 4px; color: #aaa; font-size: 13px; }
    .opacity-controls.visible { display: flex; }
    .opacity-controls input[type="range"] { width: 100px; cursor: pointer; }
    .opacity-controls #opacity-value { min-width: 36px; }
    .zoom-controls { display: flex; gap: 4px; align-items: center; background: #333; padding: 4px 8px; border-radius: 4px; }
    .zoom-btn { padding: 6px 12px; background: #444; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 14px; }
    .zoom-btn:hover { background: #555; }
    .zoom-level { color: #aaa; font-size: 13px; min-width: 50px; text-align: center; }
    .overlay-close { padding: 8px 16px; background: #ef4444; border: none; color: white; border-radius: 4px; cursor: pointer; font-size: 14px; }
    .overlay-close:hover { background: #dc2626; }
    .overlay-content { flex: 1; overflow: auto; position: relative; cursor: grab; }
    .overlay-content.dragging { cursor: grabbing; }
    .overlay-content .img-wrapper { min-width: 100%; min-height: 100%; display: flex; }
    .overlay-content .img-stack { margin: auto; width: 100%; position: relative; transform-origin: center center; transition: transform 0.1s ease-out; }
    .overlay-content img { width: 100%; display: block; }
    .overlay-content .img-top { position: absolute; top: 0; left: 0; opacity: 0.6; display: none; }
    .overlay-hint { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.8); color: #aaa; padding: 8px 16px; border-radius: 4px; font-size: 13px; z-index: 10; }
    .overlay-hint kbd { display: inline-block; padding: 2px 6px; margin: 0 4px; background: #333; border-radius: 3px; color: #fff; }
`;

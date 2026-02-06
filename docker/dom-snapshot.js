/**
 * DOM snapshot extraction function for page.evaluate().
 * Self-contained - no external dependencies.
 *
 * Walks the DOM, collects bounding boxes, computed style subsets, and text.
 * Returns a flat array with child indices for compact serialization.
 */

/* eslint-disable no-var */
function captureDomSnapshot(maxElements) {
  maxElements = maxElements || 2000;

  var STYLE_PROPS = [
    'color',
    'backgroundColor',
    'fontSize',
    'fontFamily',
    'fontWeight',
    'lineHeight',
    'padding',
    'margin',
    'borderWidth',
    'borderColor',
    'display',
    'position',
    'opacity',
  ];

  var elements = [];
  var nodeToIndex = new Map();

  function getCssSelector(el) {
    if (el.id) return '#' + el.id;
    var parts = [];
    var current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      var tag = current.tagName.toLowerCase();
      var parent = current.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function (c) {
          return c.tagName === current.tagName;
        });
        if (siblings.length > 1) {
          var idx = siblings.indexOf(current) + 1;
          tag += ':nth-of-type(' + idx + ')';
        }
      }
      parts.unshift(tag);
      current = parent;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  function getDirectText(el) {
    var text = '';
    for (var i = 0; i < el.childNodes.length; i++) {
      var node = el.childNodes[i];
      if (node.nodeType === 3) {
        // Text node
        var t = node.textContent.trim();
        if (t) text += (text ? ' ' : '') + t;
      }
    }
    return text || undefined;
  }

  function walkDOM(node) {
    if (elements.length >= maxElements) return -1;
    if (node.nodeType !== 1) return -1; // Element nodes only

    var el = node;
    var rect = el.getBoundingClientRect();
    var w = Math.round(rect.width);
    var h = Math.round(rect.height);

    // Skip zero-size elements
    if (w === 0 && h === 0) return -1;

    var scrollY = window.scrollY || document.documentElement.scrollTop || 0;
    var scrollX = window.scrollX || document.documentElement.scrollLeft || 0;

    var index = elements.length;
    var computed = window.getComputedStyle(el);
    var styles = {};
    for (var i = 0; i < STYLE_PROPS.length; i++) {
      var prop = STYLE_PROPS[i];
      var val = computed.getPropertyValue(
        prop.replace(/[A-Z]/g, function (m) {
          return '-' + m.toLowerCase();
        })
      );
      if (val) styles[prop] = val;
    }

    var entry = {
      path: getCssSelector(el),
      tag: el.tagName.toLowerCase(),
      box: {
        x: Math.round(rect.left + scrollX),
        y: Math.round(rect.top + scrollY),
        w: w,
        h: h,
      },
      styles: styles,
      children: [],
    };

    var text = getDirectText(el);
    if (text) entry.text = text;

    if (el.id) entry.id = el.id;
    var testId = el.getAttribute('data-testid');
    if (testId) entry.testId = testId;

    elements.push(entry);
    nodeToIndex.set(el, index);

    // Walk children
    var childIndices = [];
    for (var c = 0; c < el.children.length; c++) {
      var childIndex = walkDOM(el.children[c]);
      if (childIndex !== -1) childIndices.push(childIndex);
    }
    elements[index].children = childIndices;

    return index;
  }

  walkDOM(document.body);

  return {
    version: 1,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    scrollSize: {
      width: Math.max(document.body.scrollWidth || 0, document.documentElement.scrollWidth || 0),
      height: Math.max(document.body.scrollHeight || 0, document.documentElement.scrollHeight || 0),
    },
    elements: elements,
    capturedAt: new Date().toISOString(),
  };
}

module.exports = { captureDomSnapshot };

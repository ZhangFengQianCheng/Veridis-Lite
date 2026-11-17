const paths = {
    plus: '<path d="M12 5v14M5 12h14"/>', xmark: '<path d="m6 6 12 12M6 18 18 6"/>',
    pen: '<path d="m15 4 5 5M4 20l5-1L20 8a3.5 3.5 0 0 0-5-5L4 14z"/>',
    'pen-to-square': '<path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7M17 3l4 4-9 9-5 1 1-5z"/>',
    'trash-can': '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
    'magnifying-glass': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
    'ellipsis-vertical': '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    'arrow-up': '<path d="M12 20V4m-6 6 6-6 6 6"/>',
    'arrow-down': '<path d="M12 4v16m-6-6 6 6 6-6"/>',
    'arrow-down-up': '<path d="M7 4v16m-4-4 4 4 4-4M17 20V4m-4 4 4-4 4 4"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    gear: '<path d="M10 3h4l.6 2.5 1.7 1 2.5-.7 2 3.4-1.9 1.8v2l1.9 1.8-2 3.4-2.5-.7-1.7 1L14 21h-4l-.6-2.5-1.7-1-2.5.7-2-3.4L5.1 13v-2L3.2 9.2l2-3.4 2.5.7 1.7-1L10 3Z"/><circle cx="12" cy="12" r="3"/>',
};

export const icon = name => `<svg class="vrl-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.plus}</svg>`;

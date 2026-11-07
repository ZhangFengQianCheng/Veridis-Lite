// updateMessageBlock runs SillyTavern's native formatting/regex pipeline.
// MESSAGE_UPDATED then lets JS-Slash-Runner and template renderers rebuild.
export async function refreshDisplay(context, eventSource, eventTypes, index, message) {
    if (typeof context.updateMessageBlock !== 'function') throw new Error('酒馆未提供消息刷新接口。');
    await context.updateMessageBlock(index, message, { rerenderMessage: true });
    const type = eventTypes.MESSAGE_UPDATED || eventTypes.CHARACTER_MESSAGE_RENDERED;
    if (type) await eventSource.emit(type, index);
}

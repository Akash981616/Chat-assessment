import type { Message } from '../persistence/contracts.js';

type MessagePublisher = (chatId: string, message: Message) => void;
let publishMessage: MessagePublisher | undefined;

export function registerMessagePublisher(publisher: MessagePublisher): void {
  publishMessage = publisher;
}

export function emitChatMessage(chatId: string, message: Message): void {
  publishMessage?.(chatId, message);
}

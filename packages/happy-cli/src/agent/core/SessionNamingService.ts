import { ApiSessionClient } from '../../api/apiSession';
import { logger } from '../../ui/logger';
import Anthropic from '@anthropic-ai/sdk';

export class SessionNamingService {
  /**
   * 触发异步起名（Fire and forget）
   * @param session 当前的 API 会话客户端
   * @param firstUserMessage 用户输入的第一条消息
   */
  public static triggerNaming(session: ApiSessionClient, firstUserMessage: string): void {
    Promise.resolve().then(async () => {
      try {
        // 1. 硬截断：防止超长日志或代码拖慢小模型速度（截取前 1000 字符）
        const truncatedMessage = firstUserMessage.trim().substring(0, 1000);
        if (!truncatedMessage) return;

        // 2. 构建起名 Prompt，强化语种跟随指令
        const systemPrompt = `
You are a session title generator. 
Task: Generate a concise title (3 to 6 words) summarizing the user's message.
Constraints:
- Output ONLY the title text.
- No quotes, no punctuation at the end, no conversational filler.
- CRITICAL: Respond strictly in the SAME LANGUAGE as the user's message.
`.trim();

        // 3. 准备调用模型，使用 Anthropic SDK 直接发请求。
        const anthropic = new Anthropic({
          // 会自动读取 process.env.ANTHROPIC_API_KEY
        });

        logger.debug(`[SessionNamingService] Triggering title generation for session ${session.sessionId}`);

        const response = await anthropic.messages.create({
          model: 'claude-3-haiku-20240307',
          max_tokens: 20,
          temperature: 0.3,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: truncatedMessage
            }
          ]
        });

        const title = response.content[0].type === 'text' ? response.content[0].text : undefined;

        // 4. 下发事件给 App 端：通过更新 metadata.summary.text 自动同步标题
        if (title) {
          logger.debug(`[SessionNamingService] Generated title: "${title}"`);
          session.updateMetadata((metadata) => ({
             ...metadata,
             summary: {
               text: title.trim(),
               updatedAt: Date.now()
             }
          }));
        }
      } catch (error) {
        // 5. 静默失败兜底：遇到网络超时或错误，直接吃掉，绝不抛给主流程
        logger.debug(`[SessionNamingService] Failed to generate title for ${session.sessionId}:`, error);
      }
    });
  }
}

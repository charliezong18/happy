import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logger } from '@/ui/logger';

function getClaudeOAuthToken(): string | null {
    if (process.env.ANTHROPIC_API_KEY) {
        return process.env.ANTHROPIC_API_KEY;
    }
    
    // Fallback to reading cron.env where the user explicitly saved it
    try {
        const envPath = path.join(os.homedir(), '.config', 'claude-code', 'cron.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            const match = content.match(/(?:ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)=(.+)/);
            if (match && match[1]) {
                // Remove potential quotes
                return match[1].trim().replace(/^['"]|['"]$/g, '');
            }
        }
    } catch (e) {
        // Suppress errors
    }

    return null;
}

export async function generateSessionTitle(firstUserMessage: string): Promise<string | null> {
    const token = getClaudeOAuthToken() || process.env.ANTHROPIC_API_KEY;
    if (!token) {
        logger.debug('[SessionNaming] No Anthropic token available to generate session title');
        return null;
    }
    
    try {
        logger.debug('[SessionNaming] Generating session title with Claude Haiku...');
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01',
                // Handle both OAuth tokens and regular API keys
                ...(token.startsWith('sk-ant-api') ? { 'x-api-key': token } : { 'Authorization': `Bearer ${token}` })
            },
            body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 20,
                system: "You are a conversation title generator. Based on the user's message, generate a concise title (3 to 6 words). Do NOT use quotes, punctuation, or conversational filler. Output ONLY the title.",
                messages: [
                    { role: 'user', content: firstUserMessage }
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`Anthropic API error: ${response.status}`);
        }

        const data = await response.json() as any;
        const title = data.content[0].text.trim();
        logger.debug(`[SessionNaming] Generated title: ${title}`);
        return title;
    } catch (error) {
        logger.debug('[SessionNaming] Title generation failed:', error);
        return null;
    }
}

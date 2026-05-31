'use strict'

/**
 * Linear webhook formatter.
 *
 * Linear signs with the Linear-Signature header (raw hex), which the linear
 * verifier profile reads automatically. Use your Linear webhook signing secret
 * as WEBHOOK_SECRET.
 *
 * Returns a Markdown body; the renderer derives the HTML and plain-text parts.
 */
module.exports = function format(p) {
  if (p.type === 'Issue' && (p.action === 'create' || p.action === 'update')) {
    const d = p.data || {}
    return {
      subject: `Linear ${p.action}: ${d.identifier || ''} ${d.title || ''}`.trim(),
      markdown: [
        `# ${d.identifier || 'Issue'}: ${d.title || 'Untitled'}`,
        '',
        `**State:** ${d.state?.name || '?'}`,
        `**Priority:** ${d.priorityLabel || 'None'}`,
        d.description ? `\n${d.description}` : '',
        d.url ? `\n[Open in Linear](${d.url})` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  }

  return null
}

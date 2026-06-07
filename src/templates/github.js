'use strict'

/**
 * GitHub webhook formatter.
 *
 * Configure the repository webhook with content type application/json and your
 * WEBHOOK_SECRET as the secret. GitHub signs with X-Hub-Signature-256, which the
 * github verifier profile reads automatically.
 *
 * Returns a Markdown body; the renderer derives the HTML and plain-text parts.
 */
module.exports = function format(p) {
  if (p.commits && p.repository) {
    const repo = p.repository.full_name
    const branch = (p.ref || '').replace('refs/heads/', '')
    const count = p.commits.length

    // Branch deletes and tag-only pushes arrive as zero-commit push events.
    // They are noise for an email digest, so drop them without delivering.
    if (count === 0) return { skip: true }
    const lines = [
      `# ${count} commit${count === 1 ? '' : 's'} to ${repo}@${branch}`,
      '',
      ...p.commits.map((c) => `- ${c.message.split('\n')[0]} (${c.author?.name || 'unknown'})`),
    ]
    if (p.compare) lines.push('', `[View diff on GitHub](${p.compare})`)
    return { subject: `${count} commit${count === 1 ? '' : 's'}: ${repo}@${branch}`, markdown: lines.join('\n') }
  }

  if (p.pull_request) {
    const pr = p.pull_request
    return {
      subject: `PR ${p.action}: #${pr.number} ${pr.title}`,
      markdown: [
        `# PR #${pr.number}: ${pr.title}`,
        '',
        `**${pr.user?.login || 'someone'}** ${p.action} this pull request.`,
        '',
        `[${pr.html_url}](${pr.html_url})`,
      ].join('\n'),
    }
  }

  return null
}

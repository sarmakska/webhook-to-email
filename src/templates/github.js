/**
 * GitHub webhook formatter.
 * Set webhook secret to your WEBHOOK_SECRET, content type application/json.
 * GitHub sends header `X-Hub-Signature-256: sha256=<hex>` which the server understands.
 */
module.exports = function format(p) {
  if (p.commits && p.repository) {
    const repo = p.repository.full_name
    const branch = (p.ref || '').replace('refs/heads/', '')
    return {
      subject: `📦 ${p.commits.length} commit${p.commits.length === 1 ? '' : 's'} · ${repo}@${branch}`,
      text: p.commits.map((c) => `- ${c.message.split('\n')[0]} (${c.author.name})`).join('\n'),
      html: `<h2>${repo} · ${branch}</h2>
<ul>${p.commits.map((c) => `<li><b>${c.author.name}:</b> ${c.message.split('\n')[0]}</li>`).join('')}</ul>
<p><a href="${p.compare}">View on GitHub</a></p>`,
    }
  }
  if (p.pull_request) {
    const pr = p.pull_request
    return {
      subject: `🔀 PR ${p.action} · #${pr.number} · ${pr.title}`,
      text: `${pr.user.login} ${p.action} PR #${pr.number}\n${pr.html_url}`,
      html: `<h2>${pr.title}</h2><p>${pr.user.login} ${p.action} PR #${pr.number}</p><p><a href="${pr.html_url}">${pr.html_url}</a></p>`,
    }
  }
  return null
}

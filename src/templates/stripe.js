'use strict'

/**
 * Stripe webhook formatter.
 *
 * Use the Stripe webhook signing secret as WEBHOOK_SECRET. Stripe signs with the
 * timestamped Stripe-Signature header, and the per-provider verifier validates
 * both the signature and the timestamp tolerance.
 *
 * Returns a Markdown body; the renderer derives the HTML and plain-text parts.
 */
module.exports = function format(p) {
  if (p.type === 'invoice.paid') {
    const inv = p.data?.object || {}
    const amount = ((inv.amount_paid || 0) / 100).toFixed(2)
    const ccy = (inv.currency || 'gbp').toUpperCase()
    const lines = [
      '# Invoice paid',
      '',
      `**Amount:** ${amount} ${ccy}`,
      `**Customer:** ${inv.customer_email || '?'}`,
      `**Invoice:** ${inv.number || inv.id || '?'}`,
    ]
    if (inv.hosted_invoice_url) lines.push('', `[View on Stripe](${inv.hosted_invoice_url})`)
    return { subject: `Invoice paid: ${amount} ${ccy}`, markdown: lines.join('\n') }
  }

  if (p.type === 'customer.subscription.created') {
    const sub = p.data?.object || {}
    return {
      subject: `New subscription: ${sub.id}`,
      markdown: ['# New subscription', '', `**Customer:** ${sub.customer || '?'}`, `**Status:** ${sub.status || '?'}`].join('\n'),
    }
  }

  return null
}

/**
 * Stripe webhook formatter.
 * Set Stripe webhook signing secret as WEBHOOK_SECRET. Stripe sends sha256= hex format.
 */
module.exports = function format(p) {
  if (p.type === 'invoice.paid') {
    const inv = p.data?.object || {}
    const amount = ((inv.amount_paid || 0) / 100).toFixed(2)
    const ccy = (inv.currency || 'gbp').toUpperCase()
    return {
      subject: `💸 Invoice paid · ${amount} ${ccy}`,
      text: `Customer: ${inv.customer_email || '?'}\nInvoice: ${inv.number || inv.id}\nAmount: ${amount} ${ccy}`,
      html: `<h2>Invoice paid</h2>
<p><b>Customer:</b> ${inv.customer_email || '?'}</p>
<p><b>Invoice:</b> ${inv.number || inv.id}</p>
<p><b>Amount:</b> ${amount} ${ccy}</p>`,
    }
  }
  if (p.type === 'customer.subscription.created') {
    const sub = p.data?.object || {}
    return {
      subject: `🎉 New subscription · ${sub.id}`,
      text: `Customer: ${sub.customer}\nStatus: ${sub.status}`,
      html: `<h2>New subscription</h2><p><b>Customer:</b> ${sub.customer}</p><p><b>Status:</b> ${sub.status}</p>`,
    }
  }
  return null
}

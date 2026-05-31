'use strict'

/**
 * Cal.com booking webhook formatter.
 *
 * Configure a Cal.com webhook for the BOOKING_CREATED trigger. Cal.com signs
 * with X-Cal-Signature-256, which the cal verifier profile reads automatically.
 *
 * Returns a Markdown body; the renderer derives the HTML and plain-text parts.
 */
module.exports = function format(p) {
  if (p.triggerEvent === 'BOOKING_CREATED' || p.payload?.title) {
    const b = p.payload || p
    const attendee = b.attendees?.[0] || {}
    return {
      subject: `New booking: ${attendee.name || 'Someone'} - ${b.title || ''}`.trim(),
      markdown: [
        '# New booking',
        '',
        `**Title:** ${b.title || '-'}`,
        `**Attendee:** ${attendee.name || '?'} (${attendee.email || ''})`,
        `**Start:** ${b.startTime || '?'}`,
        `**End:** ${b.endTime || '?'}`,
        `**Timezone:** ${attendee.timeZone || '?'}`,
      ].join('\n'),
    }
  }

  return null
}

/**
 * Cal.com booking webhook formatter.
 * Configure: webhook from cal.com sending JSON of triggerEvent BOOKING_CREATED.
 */
module.exports = function format(p) {
  if (p.triggerEvent === 'BOOKING_CREATED' || p.payload?.title) {
    const b = p.payload || p
    const attendee = b.attendees?.[0] || {}
    return {
      subject: `📅 New booking · ${attendee.name || 'Someone'} · ${b.title || ''}`,
      text: `Title: ${b.title}\nWith: ${attendee.name} <${attendee.email}>\nWhen: ${b.startTime}`,
      html: `<h2>New booking</h2>
<p><b>Title:</b> ${b.title || '—'}</p>
<p><b>Attendee:</b> ${attendee.name || '?'} &lt;${attendee.email || ''}&gt;</p>
<p><b>Start:</b> ${b.startTime || '?'}</p>
<p><b>End:</b> ${b.endTime || '?'}</p>
<p><b>Timezone:</b> ${attendee.timeZone || '?'}</p>`,
    }
  }
  return null
}

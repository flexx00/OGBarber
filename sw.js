self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : { title:'Booking', body:'New booking placed!' };
    const options = { body: data.body, icon:'images/paste.png', badge:'images/spray.png' };
    event.waitUntil(self.registration.showNotification(data.title, options));
});
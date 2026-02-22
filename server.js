// server.js
const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json());

const DISCORD_WEBHOOK = "https://canary.discord.com/api/webhooks/1475119321020760256/nrO83jn0qfozhrb_iim7bFcjqgeD3UCG9s4JPaDCSo-05vhE3ylboPVNKVlUtDxjB8sa";

app.post('/book', async (req,res)=>{
  const booking = req.body;
  try {
    await fetch(DISCORD_WEBHOOK,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ embeds:[{
        title:"New Booking",
        description:`**Name:** ${booking.name}\n**Date:** ${booking.date}\n**Time:** ${booking.time}\n**Services:** ${booking.services.join(", ")}\n**Total:** £${booking.total}`,
        color:16753920
      }]})
    });
    res.json({ ok:true });
  } catch(err){
    console.error(err);
    res.status(500).json({ ok:false });
  }
});

app.listen(5000, ()=>console.log("Server running on port 5000"));

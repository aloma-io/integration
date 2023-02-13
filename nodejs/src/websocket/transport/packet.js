const fetch  = require('node-fetch');
const cuid   = require('@paralleldrive/cuid2').init({length: 32});

class Packet 
{
  constructor(data = {})
  {
    this.data = data;
    this.data.id ||= cuid();
  }
  
  id()
  {
    return this.data.id;
  }
  
  cb(what)
  {
    if (what)
    {
      this.data.c = what;
    }
    
    return this.data.c;
  }
  
  
  method(what)
  {
    if (what)
    {
      this.data.m = what;
    }
    
    return this.data.m;
  }
  
  event(what)
  {
    if (what)
    {
      this.data.e = what;
    }
    
    return this.data.e;
  }
  
  args(what)
  {
    if (what)
    {
      this.data.a = what;
    }
    
    return this.data.a;
  }
}

class Callback
{
  constructor({cb})
  {
    this.cb = cb;
    this.created = Date.now();
  }
}

module.exports = {Callback, Packet}
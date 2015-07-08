# litedb

litedb for store json objects  to disk.it's a little db.
support query like moongodb,support **crud,stored,trigger,total.** 

## Installation
```bash

$ npm install --save litedb

```


## connect
```javascript

var db = require('liteDB');
db.connect('./db',["users"]);
db.connect(['accounts']);


```
## trigger

```javascript

//create trigger

db.util.trigger("beforeUserSave", function(user) {
    user.age = 38;
    user.mail = "bona shen@gmail.com";
});

//assemble trigger for db.users

db.beforeUserSave.assemble(db.users, "beforeSaveTrigger");

//drop trigger
db.beforeUserSave.drop();

```

## listen event

```javascript

db.events.on("collection/onSave", function(evt) {
    console.log("collection/onSave");
});

```

## save json

```javascript

db.users.save({
    name: "bona shen",
    comments: ["peter's Father", "kerry's father"]
});

db.users.save({
    name: "ychunx",
    comments: ["", "kerry's mather",""],
    age:35
});

```
## query
```javascript

db.users.find({
    age: {
        $gt: 30
    }
}).forEach(function(o) {
    console.log(o);
});

console.log("find:", db.users.find({
    comments: /mather/
}));

```

/**
 * Created by bona on 2015/7/8.
 */
var db = require('../lib/liteDB');

db.connect('./db',["users"]);

db.util.trigger("beforeUserSave", function(user) {
    user.age = 38;
    user.mail = "bona shen@gmail.com";
});

db.beforeUserSave.assemble(db.users, "beforeSaveTrigger");

db.events.on("collection/onSave", function(evt) {
    console.log("collection/onSave");
});

db.users.save({
    name: "bona shen",
    comments: ["peter's Father", "kerry's father"]
});

db.beforeUserSave.drop();

db.users.save({
    name: "ychunx",
    comments: ["", "kerry's mather",""],
    age:35
});

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

console.log(db.users.orderBy("age,name"));

console.log(db.users.data);

//db.yongUsers.exec();
//db.util.stored("yongUsers",function(){return db.users});

//console.log(db.yongUsers.exec.toString());

//db.storeData();
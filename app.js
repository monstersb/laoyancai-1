var _ = require('underscore');
var bodyParser = require('body-parser');
var express = require('express');
var http = require('http');
var uuid = require('node-uuid');

var app = express();
var server = http.Server(app);
var io = require('socket.io')(server);


server.listen(8888);
app.use(express.static(__dirname));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');


app.get('/', function(req, res) {
  var rs = [];
  _.forEach(rooms, function(room) {
    if (room == undefined) {
      return;
    }
    rs.push({id: room.id, name: room.banker.name, num: room.players.length+1});
  });
  res.render('index', {rooms: rs});
});


app.post('/', function(req, res) {
  var username = req.param('username');
  var roomId = uuid.v4();
  res.redirect('/room/'+roomId+'/?username='+username);
});


app.get('/room/:roomId/', function(req, res) {
  var username = req.query.username;
  var roomId = req.params.roomId;
  var room = rooms[roomId];

  if (room === undefined) {
    if (username === undefined) {
      res.redirect('/');
    } else {
      res.render('room', {roomId: roomId, isBanker: true, bankerName: username});
    }
  } else {
    res.render('room', {roomId: roomId, isBanker: false, bankerName: undefined});
  }
});


function _card2str(card) {
  var num = Math.floor(card / 4) + 1;
  var color = card % 4;
  var b;

  if (num === 1) {
    b = 'A';
  } else if (num === 11) {
    b = 'J';
  } else if (num === 12) {
    b = 'Q';
  } else if (num === 13) {
    b = 'K';
  } else {
    b = num;
  }

  if (color == 0) {
    return '♠ ' + b;
  } else if (color == 1) {
    return '♥ ' + b;
  } else if (color == 2) {
    return '♣ ' + b;
  } else {
    return '♦ ' + b;
  }
}


function Player(username, socket) {
  this.name = username;   // 玩家用户名
  this.cards = [];        // 玩家手牌
  this.totalChip = 1000;  // 总共的筹码
  this.status = 'p';      // 游戏中
  this.bet = 0;           // 下注金额
  this.isBeted = false;   // 是否下注
  this.socket = socket;
}


Player.prototype.isBurst = function(){
  // 是否炸开
  if (8 === this.value(2) || this.value(2) == 9) {
    return true;
  }
  return false;
};


Player.prototype.isMultiple = function() {
  // 是否翻倍 是：返回倍数 否：返回 false
  var colors = _.map(this.cards, function(card) {
    return card % 4;
  });
  var q = colors[0];
  var ret = _.every(colors, function(color) {
    return color === q;
  });

  if (ret === true) {
    return colors.length;
  }
  return false;
};


Player.prototype.notifyStartGame = function() {
  // 通知用户游戏开始
  var cards = [];
  _.forEach(this.cards, function(card) {
    cards.push(_card2str(card));
  });
  this.socket.emit('noti start game', {cards: cards, isBurst: this.isBurst()});
};


Player.prototype.makeBet = function(num) {
  // 下注
  this.bet = num;
  this.isBeted = true;
};


Player.prototype.value = function(num) {
  // 用户前num张手牌的点数
  var sum = 0;
  var cards = this.cards.slice(0, num);

  _.forEach(cards, function(card) {
    var point = Math.floor(card / 4) + 1;
    if (point < 10) {
      sum += point;
    }
  });
  return sum % 10;
};


Player.prototype.winChip = function(multiple) {
  if (multiple === false) {
    return this.bet;
  }
  return multiple * this.bet;
};


Player.prototype.notifyNewCard = function() {
  // 通知用户获得新牌
  this.socket.emit('recive card', _card2str(this.cards[2]));
};


function Room(id, banker) {
  this.id = id;                 // 房间id
  this.banker = banker;         // 庄家
  this.players = [];            // 玩家
  this.cards = _.range(0, 52);  // 牌池
  this.turn = 0;                // 当前回合的玩家index
}


Room.prototype.joinPlayer = function(player) {
  // 房间加入玩家
  this.players.push(player);
};


Room.prototype.notifyUpdatePlayerList = function() {
  // 通知更新玩家列表
  var playerList = [{name: this.banker.name, bet: '我是庄家', totalChip: this.banker.totalChip}];

  _.forEach(this.players, function(player) {
    playerList.push({name: player.name, bet: player.bet, totalChip: player.totalChip});
  });

  io.to(this.id).emit('update player list', playerList);
};


Room.prototype.startGame = function() {
  // 开始游戏
  var self = this;
  var ret = _.every(self.players, function(player) {
    return player.isBeted === true;
  });

  if (ret === false) {
    self.broadcast('有人没有下注，无法开始游戏');
    return;
  }

  self.broadcast('开始游戏');

  _.forEach(this.players, function(player) {
    self.dealCard(player, 2, function() {
      if (player.isBurst()) {
        self.broadcast(player.name + '炸开');
        self.computeResult(player);
      }
      player.notifyStartGame();
    });
  });

  this.dealCard(this.banker, 2, function(){
    self.banker.notifyStartGame();
    if (self.banker.isBurst()) {
      self.broadcast('庄家炸开');
      self.endGame();
      return;
    } else {
      self.nextRound();
    }
  });
};


Room.prototype.resetGame = function() {
  // 重置游戏
  this.cards = _.range(0, 52);
  _.forEach(this.players, function(player) {
    player.status = 'p';
    player.cards = [];
    player.isBeted = false;
    player.bet = 0;
  });
  this.banker.status = 'p';
  this.banker.cards = [];
  this.turn = 0;
};


Room.prototype.endGame = function() {
  // 游戏结束
  var self = this;

  this.showCards();
  _.forEach(this.players, function(player) {
    self.computeResult(player);
  });

  this.broadcast('本轮结束, 等待庄家开始游戏');
  this.resetGame();
  this.notifyUpdatePlayerList();
  io.to(this.id).emit('game end');
};


Room.prototype.dealCard = function(player, num, fn) {
  // 发牌 player: 玩家  num: 牌张数  fn: 回调函数
  var self = this;

  function _dealCard() {
    var len = self.cards.length;
    var index = _.random(1, 100) % len;
    var card = self.cards[index];
    self.cards.splice(index, 1);
    return card;
  }

  for (var i=0; i<num; i++) {
    player.cards.push(_dealCard());
  }
  if (player.status === 'p' && player.isBurst()) {
    player.status = 'e';
  }
  fn();
};

Room.prototype.showCards = function() {
  // 展示所有玩家手牌

  var self = this;
  self.broadcast('-------------------');
  self.broadcast('庄家  ' + _.map(self.banker.cards, _card2str));
  _.forEach(this.players, function(player) {
    self.broadcast(player.name + '  ' + _.map(player.cards, _card2str));
  });
  self.broadcast('-------------------');
};


Room.prototype.nextRound = function() {
  // 下一回合
  var turn = this.turn;
  var player = this.players[turn];

  if (turn === this.players.length) {
    this.broadcast('轮到庄家，是否要牌');
    this.banker.socket.emit('need card?');
    return;
  }

  if (player.status === 'e') {
    this.turn += 1;
    this.nextRound();
    return;
  }

  this.broadcast('轮到玩家' + player.name + '，是否要牌');
  player.socket.emit('need card?');
  this.turn += 1;
};


Room.prototype.computeResult = function(player) {
  // 计算结果
  var self = this;
  var num;
  var banker = self.banker;

  if (player.status === 'e') {
    return;
  }
  player.staus = 'e';

  if (player.isBurst() && banker.isBurst() === false) {
    num = parseInt(player.winChip(player.isMultiple()));
    player.totalChip += num;
    banker.totalChip -= num;
    self.broadcast(player.name + '战胜庄家，获得' + num + '元');
    return;
  }

  if (player.value(3) > banker.value(3)) {
    num = parseInt(player.winChip(player.isMultiple()));
    player.totalChip += num;
    banker.totalChip -= num;
    self.broadcast(player.name + '战胜庄家，获得' + num + '元');
    return;
  }

  if (player.value(3) < banker.value(3)) {
    num = parseInt(player.winChip(banker.isMultiple()));
    player.totalChip -= num;
    banker.totalChip += num;
    self.broadcast(player.name + '输给庄家，损失' + num + '元');
    return;
  }

  self.broadcast(player.name + '跟庄家点数相同，走水');
};


Room.prototype.requestCard = function(needCard, player, isBanker) {
  // 申请一张新牌
  var self = this;
  if (needCard) {
    this.dealCard(player, 1, function() {
      self.broadcast(player.name + ' 新拿一张牌： ' + _card2str(player.cards[2]));
      player.notifyNewCard();

      if (isBanker === true) {
        self.endGame();
        return;
      } else {
        self.banker.socket.emit('banker rush?', player.name);
      }
    });
    return;
  } else {
    self.broadcast(player.name + '不需要拿牌');
  }
  if (isBanker === false) {
    self.banker.socket.emit('banker rush?', player.name);
  } else {
    self.endGame();
  }
};

Room.prototype.broadcast = function(msg) {
  // 游戏信息广播
  io.to(this.id).emit('info', msg);
};

Room.prototype.bankerRush = function(isRush, playerName) {
  // 庄家先与玩家决斗
  var player = _.find(this.players, function(player) {
    return player.name === playerName;
  });

  if (isRush === true) {
    this.broadcast('庄家要与' + player.name + '来一发');
    this.computeResult(player);
  }

  this.nextRound();
};


var rooms = {};  // 所有房间


io.sockets.on('connection', function(socket) {
  socket.on('disconnect', function() {
    if (socket.isBanker) {
      socket.room.broadcast('庄家离开游戏，大家散了吧');
      socket.room.broadcast('5秒后房间关闭');
      rooms[socket.room.id] = undefined;
      socket.room.notifyUpdatePlayerList();

      io.to(socket.room.id).emit('destroy room');

    } else if (socket.player !== undefined){
      socket.room.broadcast(socket.player.name + '离开游戏');
      var index = socket.room.players.indexOf(socket.player);
      socket.room.players.splice(index, 1);
      socket.room.notifyUpdatePlayerList();
    }
  });
  socket.on('create room', function(roomId, username) {
    var banker = new Player(username, socket);
    var room = new Room(roomId, banker);

    socket.join(roomId);
    socket.room = room;
    socket.player = banker;
    socket.isBanker = true;

    rooms[roomId] = room;
    socket.join(roomId);
    room.notifyUpdatePlayerList();
  });

  socket.on('join game', function(roomId, username) {
    var room = rooms[roomId];
    var player = new Player(username, socket);

    socket.join(roomId);
    socket.room = room;
    socket.player = player;
    socket.isBanker = false;

    room.joinPlayer(player);
    room.notifyUpdatePlayerList();
    room.broadcast(username + '加入游戏');
  });

  socket.on('start game', function() {
    socket.room.startGame();
  });

  socket.on('request card', function(needCard) {
    this.room.requestCard(needCard, this.player, this.isBanker);
  });

  socket.on('rush', function(rush, playerName) {
    this.room.bankerRush(rush, playerName);
  });

  socket.on('chat', function(msg) {
    io.to(socket.room.id).emit('recive chat', socket.player.name + ': ' + msg);
  });

  socket.on('bet', function(num) {
    socket.player.makeBet(num);
    socket.room.notifyUpdatePlayerList();
  });
});

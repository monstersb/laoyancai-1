var Input = ReactBootstrap.Input,
    Button = ReactBootstrap.Button,
    Grid = ReactBootstrap.Grid,
    Col = ReactBootstrap.Col,
    Row = ReactBootstrap.Row,
    Label = ReactBootstrap.Label,
    Panel = ReactBootstrap.Panel;


var Room = React.createClass({
  getDefaultProps: function() {
    return {
      isBanker: false,
      bankerName: undefined,
      roomId: undefined
    };
  },
  getInitialState: function() {
    var socket = io();
    var username;
    if (this.props.isBanker) {
      username = this.props.bankerName;
    } else {
      username = undefined;
    }
    return {
      socket: socket,
      players: [],
      username: username,
      info: [],
      chat: [],
      cards: [],
      bet: undefined,
      started: false,
      inputMsg: '',
      totalChip: 1000
    };
  },
  componentDidMount: function() {
    var socket = this.state.socket;
    var self = this;
    socket.on('update player list', function(playerList) {

      self.setState({players: playerList});
      if (self.username !== undefined) {
        var player = _.find(playerList, function(item){
          return item.name == self.username;
        });
        self.setState({totalChip: player.totalChip});
      }
    });
    socket.on('info', function(msg) {
      var info = self.state.info;
      info.push(msg);
      self.setState({info: info});
    });
    socket.on('noti start game', function(info) {
      self.setState({cards: info.cards, started: true}, function() {
        if (info.isBurst === true) {
          alert('你炸开了');
        }
      });
    });
    socket.on('need card?', function() {
      var ret = confirm('来一张牌？');
      socket.emit('request card', ret);
    });
    socket.on('banker rush?', function(username) {
      var ret = confirm('干'+username+'吗？');
      socket.emit('rush', ret, username);
    });
    socket.on('recive card', function(card) {
      var cards = self.state.cards;
      cards.push(card);
      self.setState({cards: cards});
    });
    socket.on('recive chat', function(c) {
      var cs = self.state.chat;
      cs.push(c);
      self.setState({chat: cs});
    });
    socket.on('game end', function() {
      self.setState({bet: undefined, started: false, cards: []});
    });
    socket.on('destroy room', function() {
      setTimeout(function() {
        location.href = '/';
      }, 5000);
    });
    self.setState({socket: socket}, function() {
      if (self.props.isBanker === true) {
        self.openRoom();
      }
    });
  },
  openRoom: function() {
    if (this.props.isBanker === false) {
      return;
    }
    this.state.socket.emit('create room', this.props.roomId, this.state.username);
  },
  joinGame: function() {
    var username = this.state.username;
    this.state.socket.emit('join game', this.props.roomId, username);
  },
  startGame: function() {
    this.state.socket.emit('start game');
  },
  onInputUsername: function() {
    var self = this;
    this.setState({username: this.refs.username.getValue()}, function() {
      self.joinGame();
    });
  },
  onBet: function() {
    var self = this;
    if (/^(\d)+$/.test(this.refs.bet.getValue()) === false) {
      alert('输入数字啊亲');
      return;
    }
    var bet = parseInt(this.refs.bet.getValue());
    if (bet <= 0 || bet > this.state.totalChip) {
      alert('下注不能小于0或大于你的总筹码');
      return;
    }
    this.setState({bet: bet});
    this.state.socket.emit('bet', bet);
  },
  onChat: function() {
    this.state.socket.emit('chat', this.refs.chatMsg.getValue());
    this.setState({inputMsg: ''});
  },
  onKeyDown: function(e) {
    if (e.keyCode === 13) {
      this.onChat();
    }
  },
  onChange: function(e) {
    this.setState({inputMsg: e.target.value});
  },
  renderUsernameInput: function() {
    return <div>
      <Input type="text" label="昵称" ref="username" />
      <Button bsStyle="primary" bsSize="large" onClick={this.onInputUsername}>提交</Button>
    </div>
  },
  renderInfo: function() {
    var info = _.clone(this.state.info);
    info.reverse();
    return <div className='wells' style={{height: '200px', overflow: 'auto'}}>
      {
        info.map(function(msg) {
            return <p>{msg}</p>
        })
      }
    </div>
  },
  renderPlayerList: function() {
    return <div>
      <ul>
      {
        this.state.players.map(function(player){
          return <li>ID: {player.name}  下注: {player.bet} 总筹码: {player.totalChip}</li>;
        })
      }
      </ul>
    </div>
  },
  renderCard: function() {
    return <div>
      {
        this.state.cards.map(function(card) {
          return <Label style={{"font-size": "24px;", "margin-right": "5px;"}}>{card}</Label>;
        })
      }
    </div>
  },
  renderStartGame: function() {
    if (this.props.isBanker && this.state.started === false) {
      return <Button onClick={this.startGame}>开始游戏</Button>;
    } else {
      return <div></div>;
    }
  },
  renderBet: function() {
    if (this.props.isBanker) {
      return <div></div>;
    } else if (this.state.bet !== undefined) {
      return <div></div>;
    } else {
      return <div>
        <Input type="text" label="下注" ref="bet" />
        <Button onClick={this.onBet}>确定</Button>
      </div>
    }
  },
  renderChat: function() {
    var cs = _.clone(this.state.chat);
    cs.reverse();
    return <div>
      <Panel style={{height: "200px;", overflow: "auto"}}>
      {
        _.map(cs, function(c) {
          return <p>{c}</p>;
        })
      }
    </Panel>
      <Input type="text" ref="chatMsg" onKeyDown={this.onKeyDown} onChange={this.onChange} value={this.state.inputMsg}/>
      <Button bsSize="large" block onClick={this.onChat}>发言</Button>
    </div>
  },
  render: function() {
    var grid;
    if (this.state.username === undefined) {
      grid = <Grid>
        <Row classNmae="show-grid">
          <Col xs={4} xsOffset={4}>
            {this.renderUsernameInput()}
          </Col>
        </Row>
      </Grid>
    } else {
      grid = <Grid>
        <Row classNmae="show-grid">
          <Col xs={4} md={4}>
            <b>玩家列表</b>
            {this.renderPlayerList()}
          </Col>
          <Col xs={4} md={4}>
            <b>游戏信息</b>
            {this.renderInfo()}
          </Col>
          <Col xs={4} md={4}>
            <b>聊天</b>
            {this.renderChat()}
          </Col>
        </Row>
        <Row className="show-grid">
          <Col xs={4} xsOffset={4}>
            {this.renderStartGame()}
          </Col>
        </Row>
        <Row className="show-grid">
          <Col xs={4} xsOffset={4}>
            {this.renderBet()}
          </Col>
        </Row>
        <Row className="show-grid">
          <Col xs={4} xsOffset={4}>
            {this.renderCard()}
          </Col>
        </Row>
      </Grid>
    }
    return grid;
  }
});

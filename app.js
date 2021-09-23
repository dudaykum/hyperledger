/*
 * Copyright IBM Corp. All Rights Reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

'use strict';

const { Gateway, Wallets } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const path = require('path');
const { buildCAClient, registerAndEnrollUser, enrollAdmin } = require('../../test-application/javascript/CAUtil.js');
const { buildCCPOrg1, buildWallet } = require('../../test-application/javascript/AppUtil.js');

// MODULES USED FOR BUILDING WEB APPLICATION
var http = require('http');
const express = require('express');
const app = express();


//MODULE USED TO RUN THE SHELL COMMAND FROM THE APPLICATION
const { exec } = require("child_process");
//MODULE USED TO ACCESS IPFS
const ipfsAPI = require('ipfs-api');

//USE THIS LINE IF THE IPFS IS CONNECTING TO PUBLIC MODE
const ipfs = ipfsAPI('ipfs.infura.io', '5001', {protocol: 'https'});

//USE THIS LINE IF THE IPFS IS CONNECTING TO PIRVATE MODE ( LOCAL MACHINE NODE)
// const ipfs = ipfsAPI('ip4/127.0.0.1', '5001', {protocol: 'tcp'})

//MODULE USED TO PARSE THE WEB FORM FIELDS
var formidable = require('formidable');
var bodyParser = require('body-parser'); //connects bodyParsing middleware
app.use(bodyParser({defer: true}));
app.use(bodyParser.urlencoded({extended:true}));

//MODULE USED TO OPERATE ON FILES IN WEB PAGE
var fs =require('fs-extra');

const channelName = 'mychannel';
const chaincodeName = 'ledger';
const mspOrg1 = 'Org1MSP';

//DECLARING PATH TO CREATE THE WALLET FOR USER CREDENTIALS
const walletPath = path.join(__dirname, 'wallet');
const userId = 'appUser';

const ccp =  buildCCPOrg1();
const caClient =  buildCAClient(FabricCAServices, ccp, 'ca.org1.example.com');
const gateway = new Gateway();

//FUNCTION TO PARSE THE JSON OBJECT PRETTY THE JSON IN BLOCK OUTPUT
function prettyJSONString(inputString) {
	return JSON.stringify(JSON.parse(inputString), null, 2);
}

// GET REQUEST FOR THE PAGE HELPS TO UPLOAD THE FILES TO IPFS
app.get('/',async function(req, res) {
	try {
		if (! fs.existsSync(path.resolve(__dirname,'wallet'))) {
		const wallet = await buildWallet(Wallets, walletPath);
		// in a real application this would be done on an administrative flow, and only once
		await enrollAdmin(caClient, wallet, mspOrg1);
		// in a real application this would be done only when a new user was required to be added
		// and would be part of an administrative flow
		await registerAndEnrollUser(caClient, wallet, mspOrg1, userId, 'org1.department1');
		
		
		await gateway.connect(ccp, {
			wallet,
			identity: userId,
			discovery: { enabled: true, asLocalhost: true } // using asLocalhost as this gateway is using a fabric network deployed locally
		});
		const network = await gateway.getNetwork(channelName);
		const contract = network.getContract(chaincodeName);

		let skipInit = false;
		if (process.argv.length > 2) {
			if (process.argv[2] === 'skipInit') {
				skipInit = true;
			}
		}
		if (!skipInit) {
			try {
                //INTIALIZE THE FUNCTION THE DECALRED DEFAULT FIRST VALUE IN HYPERLEDGER
				await contract.submitTransaction('InitLedger');
			} catch (initError) {
				// this is error is OK if we are rerunning this app without restarting
				console.log(`******** initLedger failed :: ${initError}`);
			}
		} else {
			console.log('*** not executing "InitLedger');
		}
	}
		res.writeHead(200, {'Content-Type': 'text/html'});
		var html = buildHtml(req);
		html = html + buildIpfs(req);
		res.write(html);
		return res.end();
	}
			
	catch (error) {
		var html = buildHtml(req);
		html = html + `<div class="alert alert-danger">\
		<strong>Invalid Request!</strong> ${error}.\
		</div>`;
		res.write(html);
		return res.end();
		}
		// finally{
		// 	gateway.disconnect();
		// } 
	  });

// UPLOADS THE FILE TO THE IPFS AND STORES THE HASH VALUE ALONG WITH EXTRA DETAILS TO THE HYPERLEDGER
  app.route('/upload')
  .post( function (req, res) {
	  try {
		var form = new formidable.IncomingForm();
		form.uploadDir = __dirname;       //set upload directory
		form.keepExtensions = true;     //keep file extension
		 form.parse(req,  function(err, fields, files) {
			 var temp =files.fileUploaded.name;
        // RENAMING THE BUFFERED FILE FROM THE UPLOAD FILE FIELD TO ORIGINAL FILE NAME
		 fs.rename(files.fileUploaded.path, './'+files.fileUploaded.name,async function(err) {
        // READING THE CONTENT OF RENAMED FILE
		 let testFile = fs.readFileSync(path.join(__dirname,files.fileUploaded.name));
		 //DELETEING THE TEMPORARILY LOADED FILES
		 await fs.unlink(path.join(__dirname,files.fileUploaded.name));
		let testBuffer = new Buffer.from(testFile);
        //ADDING THE FILE TO IPFS USING THE FILE BUFFER
		ipfs.files.add(testBuffer,async function (err, file) {
		   if(err){
			 console.log(err);
		   }
        // GETTING THE METADATA INFO FROM THE FILE
		 var filename = files.fileUploaded.name;
		 var fileType = files.fileUploaded.type;
		 var fileExt = filename.substring(filename.lastIndexOf("."));
		 var fileModifyDate = files.fileUploaded.lastModifiedDate;
		   try{
		   const wallet =  await buildWallet(Wallets, walletPath);
			await gateway.connect(ccp, {
				wallet,
				identity: userId,
				discovery: { enabled: true, asLocalhost: true } 
			});
			const network = await gateway.getNetwork(channelName);
			const contract = network.getContract(chaincodeName);
            // UPLOADING THE FILE INFO TO THE HYPERLEDGER
			let result = await contract.submitTransaction('CreateAsset', file[0]["hash"], filename, fileType, fileExt, file[0]["size"], 
			fileModifyDate, `http://127.0.0.1:8080/ipfs/${file[0]["path"]}`, fields["owner"] , fields["desc"]);
            //FABRICATING TO SHOW THE OUTPUT SUCCESS
			let outcome = `<div class="alert alert-success">
			<strong>Success!</strong> File uploaded succssfully to IPFS, below details are saved to Hyperledger.
		  </div>
		  	<div class="form-group">\
			<label >File Name:</label>\
			<input type="text" class="form-control" readonly value="${filename}" >\
			<label >File Type:</label>\
			<input type="text" class="form-control" readonly value="${fileType}" >\
			<label >File Extension:</label>\
			<input type="text" class="form-control" readonly value="${fileExt}" >\
			<label >Hash Value:</label>\
			<input type="text" class="form-control" readonly value="${file[0]["hash"]}" >\
			<div><label >IPFS Path:&emsp;&emsp;&emsp;</label><a target="_blank" href="http://127.0.0.1:8080/ipfs/${file[0]["path"]}">\
			<span class="glyphicon glyphicon-new-window"></span>\
			</a></div>\
			<input type="text" class="form-control" readonly value="http://127.0.0.1:8080/ipfs/${file[0]["path"]}" >\
			<label >Upload Size:</label>\
			<input type="text" class="form-control" readonly value="${file[0]["size"]}" >\
			<label >Upload Timestamp:</label>\
			<input type="text" class="form-control" readonly value="${fileModifyDate}" >\
			<label >Owner Info:</label>\
			<input type="text" class="form-control" readonly value="${fields["owner"]}" >\
			<label >Description:</label>\
			<textarea  class="form-control"  rows="4" cols="50" readonly >${fields["desc"]}\
			  </textarea></div></br>\
			<a class="nav-link btn btn-success col-sm-offset-6" href="http://localhost:3000/showassets">Done</a>\
		  	</div>`;
			  res.writeHead(200, {'Content-Type': 'text/html'});
			  var html = buildHtml(req);
			  html = html + outcome;
			  res.write(html);
			  res.end();
			}
			catch (error) {
				var html = buildHtml(req);
				html = html + `<div class="alert alert-danger">\
				<strong>Invalid Request!</strong> ${error}.\
				</div>`;
				res.write(html);
				return res.end();
				}
				finally{
					gateway.disconnect();
				} 
				if (err)
				throw err;
			});
		 });
	 });
 }
 catch (error) {
	 console.error(`******** FAILED to run the application: ${error}`);
	 }
 });


	    // LOADS THE GET FORM FOR REGISTERING THE USER TO HYPERLEDGER
app.get('/register',async function(req, res) {
	try{
	res.writeHead(200, {'Content-Type': 'text/html'});
	var html = buildHtml(req);
	html = html + buildRegister(req) ;
	res.write(html);
	return res.end();
	}
	catch (error) {
		res.writeHead(200, {'Content-Type': 'text/html'});
		var html = buildHtml(req);
		res.write(html);
		res.write(`<div class="alert alert-danger">\
		<strong>Error!</strong> ** Failed to run the application at error : ${error} **.\
		</div>`);
		res.end();
	}
  });

  // UPLAODS THE DETAILS OF NEW USER TO REGISTER UNDER PARTICULAR MSP
app.route('/postregister')
.post(async function (req, res) {
 var html = buildHtml(req);
 html = html + buildRegister(req);
 try{
 var cas = req.body["cas"];
 var msps = req.body["msps"];
 var orgs = req.body["orgs"];
 var userid = req.body["userid"];
 const wallet = await buildWallet(Wallets, walletPath);
 await registerAndEnrollUser(caClient, wallet, msps, userid, orgs);
 html = html + `<div class="alert alert-success">\
 <strong>Success!</strong> Successfully registered the userid : ${userid} under MSP : ${msps} for department : ${orgs}.\
</div>`;
res.writeHead(200, {'Content-Type': 'text/html'});
res.write(html);
res.end()
 }
 catch (error) {
var html = buildHtml(req);
res.write(html);
res.write(`<div class="alert alert-danger">\
<strong>Error!</strong> ** Failed to run the application at error : ${error} **.\
</div>`);
res.end();
	}
});

  // SHOWS THE LIST OF THE REGISTERED USERS WITH THE MSP
  app.get('/getusers', function(req, res) {

	res.writeHead(200, {'Content-Type': 'text/html'});
	var html = buildHtml(req);
	html = html + '<div class="panel panel-default">\
					<div class="panel-body">\
						<div class="container col-sm-12">\
							<p class="alert alert-warning" ><strong>Info!</strong> Registered users with the channel ( admin.id, appUser.id are the default credentials with network creation.)</p>            \
							<table class="table table-hover">\
							  <thead>\
								<tr>\
								  <th>UserName</th>\
								  <th>MSP ID</th>\
								  <th>Type</th>\
								</tr>\
							  </thead>\
							  <tbody>\
								<tr>';
	const walletFolder =path.resolve(__dirname,'wallet');
	fs.readdir(walletFolder, (err, files) => {
		files.forEach(file => {
		var contents = fs.readFileSync(path.resolve(__dirname,'wallet',file), 'utf8');
		contents = JSON.parse(contents);
		html = html + `<td>${file}</td>
						<td>${contents["mspId"]}</td>
						<td>${contents["type"]}</td></tr>`;
		});
		html = html + '</tbody>\
		</table>\
		</div>\
		</div>\
		</div>\
		</body>';
		res.write(html);
		return res.end();
	});
  });

   //   SHOWS ALL THE ASSETS FROM THE HYPERLEDGER WITH INDIVIDUAL LINKS TO EACH ASSET
   app.get('/showassets',async function (req,res) {
	try {
		const wallet =  await buildWallet(Wallets, walletPath);
		await gateway.connect(ccp, {
			wallet,
			identity: userId,
			discovery: { enabled: true, asLocalhost: true } // using asLocalhost as this gateway is using a fabric network deployed locally
		});
		const network = await gateway.getNetwork(channelName);
		const contract = network.getContract(chaincodeName);
		res.writeHead(200, {'Content-Type': 'text/html'});
					var html = buildHtml(req);
					html = html + '<div class="panel panel-default">\
					<div class="panel-body">\
						<div class="container col-sm-12">\
							<h2>Hyperledger</h2>\
							<p>Records stored on the hyperledger world state for the test-network channel</p>';
                    // GETS THE FULL ASSESTS CURRENTLY STORED
					let result = await contract.evaluateTransaction('GetAssetsByRange', '', '');
					var myresult = JSON.parse(result.toString());
					var paneId = 0;
					var collapseIn = 'in'
					for(var item in myresult){
						if(paneId != 0){
							collapseIn = '';
						};
						html = html + '<div class="panel-group" id="accordion">\
						<div class="panel panel-default">\
						  <div class="panel-heading" style="height: 50px;">\
							<h4 class="panel-title col-sm-7" style="padding-top: 4px;">\
							<a target="_blank" href='+myresult[item]['Record']['ipfsPath']+'><span class="glyphicon glyphicon-new-window"></span></a> &nbsp;\
							  <a data-toggle="collapse" data-parent="#accordion" href="#collapse'+paneId+'">&emsp;' + myresult[item]['Record']['hashId'] +'</a>\
							</h4>\
							<h4 class="panel-title col-sm-3" >\
							  <a data-toggle="collapse" data-parent="#accordion" href="#collapse'+paneId+'">' + myresult[item]['Record']['fileName'] + '</a>\
							</h4>\
							<h4 class="panel-title col-sm-2">\
							<a class="nav-link btn btn-success" style="border-radius: 50px;" href="http://localhost:3000/getasset/' + myresult[item]['Key']+'/edit">\
							<span class="glyphicon glyphicon-edit"></span> </a>&emsp;\
							</h4>\
						  </div>\
						  <div id="collapse'+paneId+'" class="panel-collapse collapse '+collapseIn+'">\
							<div class="panel-body"> <h5><b><u>Transaction trail/s from hyperledger blockchain:</u></b></h5>\
							<table class="table table-hover">\
								<thead>\
								  <tr>\
									<th>Timestamp</th>\
									<th>Owner Info</th>\
									<th>Description</th>\
								  </tr>\
								</thead>\
								<tbody>';
                            // GETS THE FULL ASSEST HISTORY STORED ON THE LEDGER BY ITS HASH KEY
							let history = await contract.evaluateTransaction('GetAssetHistory', myresult[item]['Record']['hashId']);
							var historyResult = JSON.parse(history.toString());
						for (var histList in historyResult){
							var date = new Date(historyResult[histList]['Timestamp']['seconds'] * 1000);
							html = html +  '<tr>\
							<td>'+date+'</td>\
							<td>'+historyResult[histList]['Value']['ownerInfo']+'</td>\
							<td>'+historyResult[histList]['Value']['description']+'</td>\
						  </tr>';
						};
				
						html = html +	 	'</tbody>\
							  </table>\
							</div>\
						  </div>\
						</div>\
						</div>';
						paneId ++;
					}
					html = html + '</div>\
						</div>\
						</div>\
					</body>';
					res.write(html);
					return res.end();
		}
		
		catch (error) {
			var html = buildHtml(req);
			html = html + `<div class="alert alert-danger">\
			<strong>Invalid Request!</strong> ${error}.\
			</div>`;
			res.write(html);
			return res.end();
			}
			// finally{
			// 	gateway.disconnect();
			// } 
  });

  // LOADS THE SINGLE ASSET FROM MAIN PAGE AND FILLS WITH EDITABLE CONTENTS
	app.get('/getasset/:id/:action',async function(req, res) {

		try {
		const wallet =  await buildWallet(Wallets, walletPath);
		await gateway.connect(ccp, {
			wallet,
			identity: userId,
			discovery: { enabled: true, asLocalhost: true } // using asLocalhost as this gateway is using a fabric network deployed locally
		});
		const network = await gateway.getNetwork(channelName);
		const contract = network.getContract(chaincodeName);
		res.writeHead(200, {'Content-Type': 'text/html'});
		var html = buildHtml(req);
        // READS THE CURRENT STATE INFORMATION OF ASSET BY HASH KEY VALUE
		let	result = await contract.evaluateTransaction('ReadAsset',  req.params.id);
		var myresult = JSON.parse(result.toString());
		// console.log(myresult);
		if(req.params.action == 'edit'){
			html = html + '<form action="/postasset" method="post" onsubmit="btnSubmit.disabled = true; return true;" >';
		}
		else if(req.params.action =='delete'){
			html = html + '<form action="/deleteasset" method="post" onsubmit="btnSubmit.disabled = true; return true;" >';
		}
		html = html + '<a class="nav-link btn btn-warning pull-right" href="http://localhost:3000/showassets" ><b>X</b></a></br>\
		<label >Uploaded Time:</label></br>\
		<textarea  class="form-control"  rows="1" cols="50" name="uploadTime" readonly="readonly" >'+myresult['uploadTime']+'</textarea>\
		<label >Hash ID:</label>\
		<input type="text" class="form-control" readonly="readonly" name="hashId" value = '+myresult['hashId']+'>\
		<label >File Name:</label>\
		<input type="text" class="form-control" readonly="readonly" name="fileName" value = '+myresult['fileName']+'>\
		<label >File Type:</label>\
		<input type="text" class="form-control" readonly="readonly" name="fileType" value = '+myresult['fileType']+'>\
		<label >File Extension:</label>\
		<input type="text" class="form-control" readonly="readonly" name="fileExtenstion" value = '+myresult['fileExtenstion']+'>\
		<label >File Size:</label>\
		<input type="text" class="form-control" readonly="readonly" name="fileSize" value = '+myresult['fileSize']+'>\
		<div><label >Ipfs Path: &emsp;&emsp;&emsp;&emsp;</label><a target="_blank" href='+myresult['ipfsPath']+'>\
				<span class="glyphicon glyphicon-new-window"></span>\
				</a></div>\
		<input type="text" class="form-control" readonly="readonly" name="ipfsPath" value = '+myresult['ipfsPath']+'>\
		<label >Owner Info:</label>\
		<textarea  class="form-control"  rows="1" cols="50" name="ownerInfo" required="required" >'+myresult['ownerInfo']+'</textarea>\
		<label >Description:</label>\
		<textarea  class="form-control"  rows="4" cols="50" name="description" required="required" >'+myresult['description']+'</textarea></div></br>';
		if(req.params.action == 'edit'){
			html = html + '<input id="btnSubmit" type="submit" class="btn btn-primary col-sm-offset-6" value="Update" >  \
			</form>\
			<div class="alert alert-warning">\
					<strong>Info!</strong> Please wait till the page request processed after update.  (Do not refresh).\
					</div>\
			</body>';
		}
		else if(req.params.action =='delete'){
			html = html + '<input id="btnSubmit" type="submit" class="btn btn-danger col-sm-offset-5" value="Confirm Delete" >  \
			</form>\
			<div class="alert alert-danger">\
					<strong>Info!</strong> Proceeding for delete operation, please wait till the page request processed after update.  (Do not refresh).\
					</div>\
			</body>'
		}
		res.write(html);
		return res.end();
	}
		catch (error) {
			var html = buildHtml(req);
			html = html + `<div class="alert alert-danger">\
			<strong>Invalid Request!</strong> ${error}.\
			</div>`;
			res.write(html);
			return res.end();
			}
			// finally{
			// 	gateway.disconnect();
			// } 

	});

	   // UPDATES THE ASSET WITH NEW VALUES AND REDIRECTS TO THE SHOW ALL ASSETS
  app.route('/postasset')
  .post(async function (req, res) {
	// var uploadTime = req.body["uploadTime"];
	var hashId = req.body["hashId"];
// 	var fileName = req.body["fileName"];
// 	var fileType = req.body["fileType"];
// 	var fileExtenstion = req.body["fileExtenstion"];
//   var fileSize = req.body["fileSize"];
//   var ipfsPath = req.body["ipfsPath"];
  var ownerInfo = req.body["ownerInfo"].trim();
   var description = req.body["description"].trim();
  try {
	const wallet =  await buildWallet(Wallets, walletPath);
		await gateway.connect(ccp, {
			wallet,
			identity: userId,
			discovery: { enabled: true, asLocalhost: true } 
		});
		const network = await gateway.getNetwork(channelName);
		const contract = network.getContract(chaincodeName);
		await contract.submitTransaction('TransferAsset', hashId, ownerInfo,description);
		res.redirect('/showassets');
		return res.end();
	}
	catch (error) {
		var html = buildHtml(req);
		html = html + `<div class="alert alert-danger">\
		<strong>Invalid Request!</strong> ${error}.\
		</div>`;
		res.write(html);
		return res.end();
	}
	// finally{
	// 	gateway.disconnect();
	// } 
  });
  
	//SEARCHES THE MEDIA FILE BY THE HASH VALUE AND RETRIEVES DETAILS FROM HYPERLEDGER
    //LOADS THE SEARCH INTERFACE FOR THE MEDIA UPLOAD SEARCH
	app.get('/search', function(req, res) {
		
		res.writeHead(200, {'Content-Type': 'text/html'});
		var html = buildHtml(req);
		html = html + buildSearch(req);
		res.write(html);
		return res.end();
	});

	app.route('/postsearch')
	.post(async function (req, res) {
	try{
		
		var form = new formidable.IncomingForm();
		form.uploadDir = __dirname;       //set upload directory
		form.keepExtensions = true;     //keep file extension
		form.parse(req,  function(err, fields, files) {
			fs.rename(files.fileUploaded.path, './'+files.fileUploaded.name,async function(err) {
			let testFile = fs.readFileSync(path.join(__dirname,files.fileUploaded.name));
			//DELETEING THE TEMPORARILY LOADED FILES
			await fs.unlink(path.join(__dirname,files.fileUploaded.name));
			let testBuffer = new Buffer.from(testFile);
            //GETS THE READ ONLY HASH VALUE OF THE FILE WITHOUT UPLOADING TO IPFS
			ipfs.files.add(testBuffer,{"only-hash": true},async function (err, file) {
				var fileHash = file[0]["hash"];
				res.redirect(`getasset/${fileHash}/edit`);
			});
			});
		});
	}
	catch (error) {
		res.writeHead(200, {'Content-Type': 'text/html'});
		var html = buildHtml(req);
		html = html + `<div class="alert alert-danger">\
		<strong>Invalid Request!</strong> ${error}.\
		</div>`;
		res.write(html);
		return res.end();
		}
	
	});
	  app.listen(3000, () => console.log('App listening on port 3000!'))
//LINK FOR TO GET THE BLOCK DATA , KEEP IT BACK IN THE HTML BODY TO ACCESS
{/* <li><a class="nav-link btn btn-default" href="http://localhost:3000/block">Load Blocks</a></li>\ */}
	  function buildHtml(req) {
		  return '<head>\
		  <meta charset="UTF-8">\
		  <title>Test Network on Hyperledger</title>\
		<link rel="stylesheet" href="https://maxcdn.bootstrapcdn.com/bootstrap/3.4.1/css/bootstrap.min.css">\
		<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.5.1/jquery.min.js"></script>\
		<script src="https://maxcdn.bootstrapcdn.com/bootstrap/3.4.1/js/bootstrap.min.js"></script>\
	  </script>\
	  </head>\
		<body class="container">\
		<nav class="navbar navbar-default">\
		<div class="container-fluid">\
		  <div class="navbar-header">\
			<a class="navbar-brand">IPFS-Hyperledger</a>\
		  </div>\
		  <ul class="nav navbar-nav">\
			<li><a class="nav-link btn btn-default" href="http://localhost:3000/">Upload To IPFS</a></li>\
			<li><a class="nav-link btn btn-default" href="http://localhost:3000/showassets">Load All</a></li>\
			<li><a class="nav-link btn btn-default" href="http://localhost:3000/getusers">Registered Users</a></li>\
			<li><a class="nav-link btn btn-default" href="http://localhost:3000/search">Search</a></li>\
			<li>&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;</li>\
			<li>&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;</li>\
			<li>&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;&emsp;</li>\
			<li><a class="nav-link btn btn-default pull-right" href="http://localhost:3000/register">Register User</a></li>\
		  </ul>\
		</div>\
	  </nav>';
		}
	  
		function buildRegister(req) {
		  return '<form action="/postregister" method="post" class="panel panel-default" ></br></br>\
		  <label for="cas" class="col-sm-5">Choose a Certification Auth:</label>\
		  <select name="cas" id="cas" class="btn btn-primary dropdown-toggle col-sm-5">\
		  <option value="ca.org1.example.com" selected>ca.org1.example.com</option>\
		  <option value="ca.org2.example.com" disabled >ca.org2.example.com</option>\
		  </select></br></br>\
		  <label for="msps" class="col-sm-5">Choose a Membership Service Provider:</label>\
		  <select name="msps" id="msps" class="btn btn-primary dropdown-toggle col-sm-5" >\
		  <option value="Org1MSP" selected="selected">Org1MSP</option>\
		  <option value="Org1MSP" >Org1MSP</option>\
		  </select></br></br>\
		  <label for="orgs" class="col-sm-5">Choose a Org Department:</label>\
		  <select name="orgs" id="orgs" class="btn btn-primary dropdown-toggle col-sm-5" >\
		  <option value="org1.department1" selected="selected">org1.department1</option>\
		  <option value="org1.department1" >org1.department1</option>\
		  </select></br></br>\
		  <label for="userid" class="col-sm-5">User Name:</label>\
		  <input type="text" class="form-control" name="userid" required="required" ></br>\
		  <input type="submit" class="btn btn-primary col-sm-offset-6" value="Register"></br></br>  \
		   </form>\
		  </body>';
		}
        // USE THE LINE IF THE FILE UPLOAD NEED TO TAKE THE MULTIPLE FILES INPUT
		// <label for="owner">Select the folder containing files:</label> <input id="multip" type="file" name="fileUploaded" required="required" class="btn btn-primary"   webkitdirectory directory ></br>\
		function buildIpfs(req) {
		  return '<div class="panel panel-default">\
		  <div class="panel-heading"><div class="alert alert-info">\
		  <strong> <h1>Uploads the file to IPFS<small> (Stores the hash value to the Hyperledger)</small></h1></strong> \
		  </div></div></br>\
		  <form method="post" action="/upload" enctype="multipart/form-data" class="panel-body" onsubmit="btnSubmit.disabled = true; return true;">\
		  <input id="multip" type="file" name="fileUploaded" required="required" class="btn btn-primary"  ></br>\
		  <label for="owner">Owner Info:</label>\
					<input type="text" class="form-control" name="owner" required="required" ></br>\
					<label for="desc">File Description:</label>\
					<textarea  class="form-control"  name="desc" required="required" rows="4" cols="50">\
					</textarea></br>\
					<input id="btnSubmit" type="submit" class="btn btn-primary col-sm-offset-6" value="Upload"></br></br>\
					<div class="alert alert-warning">\
				  <strong>Info!</strong> Please wait till the page gives response after upload.  (Do not refresh).\
				  </div>\
			</form>\
		  </body>';
		}
	  
		function buildSearch(req) {
		  return '<div class="panel panel-default">\
		  <form method="post" action="/postsearch" enctype="multipart/form-data" class="panel-body" onsubmit="btnSubmit.disabled = true; return true;">\
		  <div ><label class="col-sm-3">Upload Search file here:</label>\
				  <input type="file" name="fileUploaded" class="btn btn-primary col-sm-3" required="required">\
				  <input id="btnSubmit" type="submit" class="btn btn-default col-sm-1 col-sm-offset-3" required="required" value="Search"></br></div>\
			</form>\
		  </body>';
		}

//*********************FEW UNUSED ROUTES******************* */

	// DELETES THE ASSET VALUE FORM THE WORLD STATE -- NOT USING THE APPLICATION 
	app.route('/deleteasset')
  .post(async function (req, res) {
//   console.log(req.body);
var hashId = req.body["hashId"];
	try {
	const wallet =  await buildWallet(Wallets, walletPath);
		await gateway.connect(ccp, {
			wallet,
			identity: userId,
			discovery: { enabled: true, asLocalhost: true } 
		});
		const network = await gateway.getNetwork(channelName);
		const contract = network.getContract(chaincodeName);
		console.log('\n--> Submit Transaction: DeleteAsset with ID(asset6)');
		let result  = await contract.submitTransaction('DeleteAsset', hashId);
		
		//let result = await contract.submitTransaction('DeleteAsset', hashId) ;
		res.redirect('/showassets');
		return res.end();
	}

	catch (error) {
		var html = buildHtml(req);
		html = html + `<div class="alert alert-danger">\
		<strong>Invalid Request!</strong> ${error}.\
		</div>`;
		res.write(html);
		return res.end();
		}
		// finally{
		// 	gateway.disconnect();
		// } 

  });


  	//SHOWS THE HISTORY FROM THE HYPERLEDGER
	app.get('/gethistory/:id',async function(req, res) {

		try {
		const wallet =  await buildWallet(Wallets, walletPath);
		await gateway.connect(ccp, {
			wallet,
			identity: userId,
			discovery: { enabled: true, asLocalhost: true } // using asLocalhost as this gateway is using a fabric network deployed locally
		});
		const network = await gateway.getNetwork(channelName);
		const contract = network.getContract(chaincodeName);
		res.writeHead(200, {'Content-Type': 'text/html'});
		var html = buildHtml(req);

		let result = await contract.evaluateTransaction('GetAssetHistory', '');
		var myresult = JSON.parse(result.toString());
		console.log(myresult);
		res.write(html);
		return res.end();
	}
		catch (error) {
			var html = buildHtml(req);
			html = html + `<div class="alert alert-danger">\
			<strong>Invalid Request!</strong> ${error}.\
			</div>`;
			res.write(html);
			return res.end();
			}
			// finally{
			// 	gateway.disconnect();
			// } 
	
	  });

      	// UPLOADS THE FILE TO THE IPFS AND STORES THE HASH VALUE ALONG WITH EXTRA DETAILS TO THE HYPERLEDGER
	//CHANGE ROUTE NAME IF NEED TO USE FOR ***MULTIPLE UPLOAD***
  app.route('/upload-Multiple')
  .post( function (req, res) {
	  try {
		var form = formidable({ multiples: true });
		//SETTING THE WORKING DIRECTORY AS FILE UPLOAD AND ACCESSING
		var uploadPath = path.resolve(__dirname,'uploads');
		if (fs.existsSync(uploadPath))
		{
			fs.rmdirSync(uploadPath, { recursive: true });
		}
		fs.mkdirSync(uploadPath);
		form.uploadDir = path.resolve(__dirname,'uploads');
		form.keepExtensions = true;     //keep file extension
		form.parse(req,  function(err, fields, files) {
			(files.fileUploaded).filter(obj => obj.type != "application/octet-stream").forEach(fileObj =>{
				var fileName = fileObj.name;
				fileName =fileName.substring( fileName.lastIndexOf('/') );
				console.log(fileObj.path,fileName);
			//RENAMING THE FILE UPLOADED TO THE ACTuAL FILE NAME
			fs.rename(fileObj.path, './uploads'+fileName,async function(err) {
				//LOADING THE FILE DATA TO THE VARIABLE
			let testFile = fs.readFileSync(path.join(__dirname,'uploads',fileName));
			 //DELETEING THE TEMPORARILY LOADED FILES AFTER READING INTO THE VARIABLE
			// await fs.unlink(path.join(__dirname,files.fileUploaded.name));
			//READING THE BUFFER DATA FROM THE TEST FILE
			let testBuffer = new Buffer.from(testFile);
			//ADDING THE FILE TO THE IPFS AND GET THE RESPONSE VARIABLE
			ipfs.files.add(testBuffer,{"only-hash": true},async function (err, file) {
				// var fileHash = file[0]["hash"];
				// console.log(fileHash);
			//GETTING THE META INFORMATION OF THE FILE UPLOADED TO THE VARIABLE
			//  var filename = fileObj.name;
			 var fileType = fileObj.type;
			 var fileExt = fileName.substring(fileName.lastIndexOf("."));
			 var fileModifyDate = fileObj.lastModifiedDate;
			//  console.log(fileName.substring(1),fileType,fileExt,fileModifyDate);
			   
			   const wallet =  await buildWallet(Wallets, walletPath);
				await gateway.connect(ccp, {
					wallet,
					identity: userId,
					discovery: { enabled: true, asLocalhost: true } 
				});
				const network = await gateway.getNetwork(channelName);
				const contract = network.getContract(chaincodeName);
				// CREATING THE LEDGER TRANSACTION WITH FILE META DATA AND IPFS RESPONSE
				await contract.submitTransaction('CreateAsset', file[0]["hash"], fileName.substring(1), fileType, fileExt, file[0]["size"], 
				fileModifyDate, `http://127.0.0.1:8080/ipfs/${file[0]["path"]}`, fields["owner"] , fields["desc"].trim());
				await new Promise(resolve => setTimeout(resolve, 3000));
					var html = buildHtml(req);
					html = html + `<div class="alert alert-success">\
					<strong>Upload successful!</strong>\
					</div>`;
					res.write(html);
					return res.end();
					// finally{
					// 	gateway.disconnect();
					// } 
				});
			 });
			});
	 })
	 ;
 }
 catch (error) {
	 console.error(`******** FAILED to run the application: ${error}`);
	 }
 });

 //QUERIES THE BLOCK DATA OF HYPERLEDGER - NOT USING IN THE APPLICATION
app.get('/block/:block',async function(req, res) {
    try {
        const wallet = await buildWallet(Wallets, walletPath);
        await gateway.connect(ccp, {
            wallet,
            identity: userId,
            discovery: { enabled: true, asLocalhost: true } // using asLocalhost as this gateway is using a fabric network deployed locally
        });
        const network = await gateway.getNetwork(channelName);
        const contract = network.getContract(chaincodeName);
        const cont = network.getContract('qscc');
        //QUERY SYSTEM CHAINCODE TO QUERY THE LEDGER BY BLOCK
        var resultByte = await cont.evaluateTransaction(
            'GetBlockByNumber',
            channelName,
            req.params.block
        );
      //UNCOMMENT THIS IF NEED TO QUERY BY TRANSACTIONID
      // var resultByte = await cont.evaluateTransaction(
      // 			'GetBlockByTxID',
      // 			channelName,
      // 			"937548a1681b03755a573f3cca8b4c04470f740999308f1cb338f2029bfac39b"
      // 		);
// DECODING THE PROTO-BUFFER DATA FROM THE LEDGER - BELOW MODULE IS USED
const { BlockDecoder } = require('fabric-common');
    var resultJson = BlockDecoder.decode(resultByte);
    //RECURSIVE FUNCTION TO DECODE THE BUFFER DATA FOR THOSE VALUE TYPES
      function recurse(jso) {
        for (var key of Object.keys(jso)) {
          if(typeof(jso[key])=='object' && ! Buffer.isBuffer(jso[key])){
              //RECURSING FURTHER TO OOBJECT TYPE OF DATA TYPES
            recurse(jso[key]);
          }
          else if(Buffer.isBuffer(jso[key])){
            //DECODING THE KEY VALUE IF THE DATA IS FOUND TO BE BUFFER TYPE
            jso[key] = jso[key].toString('utf8');
            // var hexval = jso[key].toString('hex');
            // if(jso[key].includes('�')) jso[key] = hexval;
          }
        }
      }
      recurse(resultJson);
      res.writeHead(200, {'Content-Type': 'text/html'});
      //UI FOR SHOWING THE BLOCK LENGTH
      var html = buildHtml(req) +'You are viewing the block data number<h4>'+req.params.block+'</h4><a class="badge btn-danger pull-right" href="http://localhost:3000/block" ><b>X</b></a></br><pre>';
      html = html + JSON.stringify(resultJson,null,'&emsp;').toString() + '</pre>';
      res.write(html);
      return res.end();
    
}
    catch (error) {
        var html = buildHtml(req);
        html = html + `<div class="alert alert-danger">\
        <strong>Invalid Request!</strong> ${error}.\
        </div>`;
        res.write(html);
        return res.end();
        }
        // finally{
        // 	gateway.disconnect();
        // } 
      });

//BUILDS THE BLOCK LENGTH IN THE UI -- NOT USING IN THE APPLICATION
app.get('/block',async function(req, res) {
    try {
  // CHECKING THE WALLET FOLDER AS IT ENSURES THAT NETWORK IS ALREDY RUNNING
  //SUCH THAT CHAINCODE COMMANDS CAN BE EXECUTED
      if ( fs.existsSync(path.resolve(__dirname,'wallet'))) {
    // TERMINAL COMMAND USED TO GET THE INFORMATION OF 'MYCHANNEL' ON HYPERLEDGER
      exec("peer channel getinfo -c mychannel",  (error, stdout, stderr) => {
        if (error) {
          console.log(`error: ${error.message}`);
          return;
        }
        if (stderr) {
          console.log(`${stderr}`);
        }
        var firstPos = stdout.indexOf("{");
        var lastPos = stdout.indexOf("}")+ 1;
        // PARSING THE LENGTH OF BLOCKCHAIN FROM THE OUTPUT
    var chainHeight = JSON.parse(stdout.substring(firstPos, lastPos))["height"];
	//STORING THE CHAINCODE LENGTH IN THE TEXT FILE EVERY TIME OVER THIS ROUTE
    // AS IT IS NOT ACCESSIBLE FROM SHELL OUTPUT DIRECTLY
		fs.writeFile('./chainHeight.txt', chainHeight.toString(), (err) => {
			if (err) throw err;
		});
		
      });
      // SETTING THE DELAY SO TO GET THE UPDATED VALUE FROM THE TEXT FILE
	  await new Promise(resolve => setTimeout(resolve, 3000));
//ACCESSING THE LENGTH VALUE FROM THE TEXT FILE
	  const output = fs.readFileSync('./chainHeight.txt', 'utf8');
		res.writeHead(200, {'Content-Type': 'text/html'});
		var html = buildHtml(req);
		//BUILDING THE BLOCK NUMBER OVER THE UI
		for(let i = 0; i < parseInt(output); i++){
			html = html + `<a href="/block/${i}"> <span class="badge">${i}</span></a>`
		}
		res.write(html);
		return res.end();
    }
    }
    catch (error) {
      var html = buildHtml(req);
      html = html + `<div class="alert alert-danger">\
      <strong>Invalid Request!</strong> ${error}.\
      </div>`;
      res.write(html);
      return res.end();
      }
    //   finally{
    //     gateway.disconnect();
    //   } 
      });
